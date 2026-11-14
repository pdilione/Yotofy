import os
import json
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.sync import (
    TrackSyncCache,
    get_spotify_client,
    fetch_playlist_tracks,
    prepare_zotify_credentials,
    download_track_with_zotify,
    YotoClient,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("yotofy-api")

# Persistent paths (mounted at /music and /data in Docker)
MUSIC_DIR = Path(os.environ.get("AUDIO_DIR", "/music" if Path("/music").exists() else "public/audio"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data" if Path("/data").exists() else "backend"))
CACHE_DB_PATH = Path(os.environ.get("CACHE_DB_PATH", str(DATA_DIR / "sync_cache.db")))
CACHE_JSON_PATH = Path(os.environ.get("CACHE_JSON_PATH", str(DATA_DIR / "sync_cache.json")))
DIST_DIR = Path(os.environ.get("FRONTEND_DIST_DIR", "dist"))

app = FastAPI(title="Yotofy FastAPI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class YotoIconRequest(BaseModel):
    playlistName: str
    trackNames: List[str] = []


class YotoIconResponse(BaseModel):
    iconGrid: List[str]
    themeColor: str
    summary: str


class SyncTriggerRequest(BaseModel):
    playlistId: Optional[str] = None
    yotoCardId: Optional[str] = None


@app.get("/api/health")
def health_check():
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = TrackSyncCache(CACHE_DB_PATH, CACHE_JSON_PATH)
    return {
        "status": "ok",
        "musicDir": str(MUSIC_DIR),
        "dataDir": str(DATA_DIR),
        "cacheDbPath": str(cache.db_path),
    }


@app.get("/api/cache")
def get_cache_state():
    cache = TrackSyncCache(CACHE_DB_PATH, CACHE_JSON_PATH)
    if cache.json_path.exists():
        return json.loads(cache.json_path.read_text(encoding="utf-8"))
    return {"tracks": {}, "playlists": {}}


@app.post("/api/yoto-icon")
def generate_yoto_icon(payload: YotoIconRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=api_key,
            http_options={"headers": {"User-Agent": "aistudio-build"}},
        )
        tracks_preview = ", ".join(payload.trackNames[:10])
        prompt = f"""
        You are a pixel art generator for a children's audio player called Yoto.
        Task: Create a 16x16 pixel art icon that represents a playlist named "{payload.playlistName}".
        The playlist contains these songs: {tracks_preview}...
        Return a JSON object with:
        1. 'iconGrid': An array of exactly 256 strings (16x16 flattened), where each string is a 6-digit HEX color code (e.g., "#FF0000").
        2. 'themeColor': A single HEX color code that compliments the icon.
        3. 'summary': A short, fun, 1-sentence description of this playlist for a child.
        """

        response = client.models.generate_content(
            model="gemini-4-hydrogen",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=YotoIconResponse,
            ),
        )
        if not response.text:
            raise ValueError("Empty response from Gemini")
        return json.loads(response.text)
    except Exception as exc:
        logger.error(f"Error generating Yoto icon: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


def _run_sync_job(playlist_id: str, card_id: Optional[str]) -> None:
    yoto_token = os.environ.get("YOTO_ACCESS_TOKEN")
    if not yoto_token:
        logger.error("Cannot run sync job: YOTO_ACCESS_TOKEN not set")
        return

    cache = TrackSyncCache(CACHE_DB_PATH, CACHE_JSON_PATH)
    sp = get_spotify_client()
    yoto = YotoClient(access_token=yoto_token)
    creds_path = prepare_zotify_credentials()

    playlist = fetch_playlist_tracks(sp, playlist_id)
    synced_tracks = []

    for track in playlist["tracks"]:
        cached = cache.get_track(track["id"])
        if cached and cached.get("transcodedSha256"):
            synced_tracks.append(
                {
                    "spotifyTrackId": track["id"],
                    "title": cached.get("title") or track["name"],
                    "artist": cached.get("artist") or track["artist"],
                    "transcodedSha256": cached["transcodedSha256"],
                    "duration": cached.get("duration") or track["duration_sec"],
                    "fileSize": cached.get("fileSize") or 0,
                }
            )
            continue

        mp3_path = download_track_with_zotify(track, creds_path)
        if not mp3_path or not mp3_path.exists():
            continue

        transcode_info = yoto.upload_and_transcode_track(mp3_path)
        sha256 = transcode_info["transcodedSha256"]
        duration_sec = int(
            transcode_info.get("transcodedInfo", {}).get("duration") or track["duration_sec"]
        )
        file_size = int(
            transcode_info.get("transcodedInfo", {}).get("fileSize") or mp3_path.stat().st_size
        )

        cache.save_track(
            spotify_track_id=track["id"],
            transcoded_sha256=sha256,
            title=track["name"],
            artist=track["artist"],
            duration_sec=duration_sec,
            file_size=file_size,
        )
        synced_tracks.append(
            {
                "spotifyTrackId": track["id"],
                "title": track["name"],
                "artist": track["artist"],
                "transcodedSha256": sha256,
                "duration": duration_sec,
                "fileSize": file_size,
            }
        )

    if synced_tracks:
        target_card = card_id or cache.get_card_id(playlist_id)
        res = yoto.upsert_myo_content(
            title=playlist["name"],
            description=playlist["description"],
            tracks_payload=synced_tracks,
            card_id=target_card,
        )
        returned_id = res.get("cardId") or (res.get("card") or {}).get("cardId") or target_card
        if returned_id:
            cache.save_card_id(playlist_id, returned_id)


@app.post("/api/sync")
def trigger_sync(req: SyncTriggerRequest, background_tasks: BackgroundTasks):
    playlist_id = req.playlistId or os.environ.get("SPOTIFY_PLAYLIST_ID")
    if not playlist_id:
        raise HTTPException(status_code=400, detail="playlistId or SPOTIFY_PLAYLIST_ID required")
    background_tasks.add_task(_run_sync_job, playlist_id, req.yotoCardId)
    return {"status": "queued", "playlistId": playlist_id}


# Serve compiled React SPA from /app/dist when present
if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))
