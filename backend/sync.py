import os
import sys
import json
import time
import glob
import shutil
import sqlite3
import logging
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any

import requests
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("yotofy-sync")

# Environment & Paths (defaults to /music and /data volumes when mounted in Docker)
_DEFAULT_MUSIC_DIR = "/music" if Path("/music").exists() else "public/audio"
_DEFAULT_DATA_DIR = "/data" if Path("/data").exists() else "backend"

YOTO_API_BASE = os.environ.get("YOTO_API_BASE", "https://api.yotoplay.com")
AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", _DEFAULT_MUSIC_DIR))
CACHE_DB_PATH = Path(os.environ.get("CACHE_DB_PATH", f"{_DEFAULT_DATA_DIR}/sync_cache.db"))
CACHE_JSON_PATH = Path(os.environ.get("CACHE_JSON_PATH", f"{_DEFAULT_DATA_DIR}/sync_cache.json"))
ZOTIFY_CREDENTIALS_PATH = Path(os.environ.get("ZOTIFY_CREDENTIALS_PATH", f"{_DEFAULT_DATA_DIR}/credentials.json"))


class TrackSyncCache:
    """
    Dual SQLite + JSON local cache mapping Spotify track IDs to Yoto transcodedSha256
    and metadata so previously synced songs are never re-downloaded or re-uploaded.
    """

    def __init__(self, db_path: Path, json_path: Path):
        self.db_path = db_path
        self.json_path = json_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._import_json_if_needed()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS synced_tracks (
                    spotify_track_id TEXT PRIMARY KEY,
                    transcoded_sha256 TEXT NOT NULL,
                    title TEXT,
                    artist TEXT,
                    duration_sec INTEGER,
                    file_size INTEGER,
                    synced_at REAL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS playlist_cards (
                    spotify_playlist_id TEXT PRIMARY KEY,
                    yoto_card_id TEXT NOT NULL,
                    updated_at REAL
                )
                """
            )
            conn.commit()

    def _import_json_if_needed(self) -> None:
        if not self.json_path.exists():
            return
        try:
            data = json.loads(self.json_path.read_text(encoding="utf-8"))
            tracks = data.get("tracks", {})
            playlists = data.get("playlists", {})
            with sqlite3.connect(self.db_path) as conn:
                for track_id, meta in tracks.items():
                    if isinstance(meta, str):
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO synced_tracks
                            (spotify_track_id, transcoded_sha256, synced_at)
                            VALUES (?, ?, ?)
                            """,
                            (track_id, meta, time.time()),
                        )
                    elif isinstance(meta, dict) and meta.get("transcodedSha256"):
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO synced_tracks
                            (spotify_track_id, transcoded_sha256, title, artist, duration_sec, file_size, synced_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                track_id,
                                meta["transcodedSha256"],
                                meta.get("title"),
                                meta.get("artist"),
                                meta.get("duration"),
                                meta.get("fileSize"),
                                meta.get("syncedAt", time.time()),
                            ),
                        )
                for pl_id, card_id in playlists.items():
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO playlist_cards
                        (spotify_playlist_id, yoto_card_id, updated_at)
                        VALUES (?, ?, ?)
                        """,
                        (pl_id, card_id, time.time()),
                    )
                conn.commit()
        except Exception as exc:
            logger.warning(f"Failed to import JSON cache {self.json_path}: {exc}")

    def _export_json(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            track_rows = conn.execute("SELECT * FROM synced_tracks").fetchall()
            pl_rows = conn.execute("SELECT * FROM playlist_cards").fetchall()

        payload = {
            "tracks": {
                row["spotify_track_id"]: {
                    "transcodedSha256": row["transcoded_sha256"],
                    "title": row["title"],
                    "artist": row["artist"],
                    "duration": row["duration_sec"],
                    "fileSize": row["file_size"],
                    "syncedAt": row["synced_at"],
                }
                for row in track_rows
            },
            "playlists": {
                row["spotify_playlist_id"]: row["yoto_card_id"]
                for row in pl_rows
            },
        }
        self.json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def get_track(self, spotify_track_id: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM synced_tracks WHERE spotify_track_id = ?",
                (spotify_track_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "spotifyTrackId": row["spotify_track_id"],
                "transcodedSha256": row["transcoded_sha256"],
                "title": row["title"],
                "artist": row["artist"],
                "duration": row["duration_sec"],
                "fileSize": row["file_size"],
            }

    def save_track(
        self,
        spotify_track_id: str,
        transcoded_sha256: str,
        title: str,
        artist: str,
        duration_sec: int,
        file_size: int,
    ) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO synced_tracks
                (spotify_track_id, transcoded_sha256, title, artist, duration_sec, file_size, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    spotify_track_id,
                    transcoded_sha256,
                    title,
                    artist,
                    duration_sec,
                    file_size,
                    time.time(),
                ),
            )
            conn.commit()
        self._export_json()

    def get_card_id(self, spotify_playlist_id: str) -> Optional[str]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT yoto_card_id FROM playlist_cards WHERE spotify_playlist_id = ?",
                (spotify_playlist_id,),
            ).fetchone()
            return row[0] if row else None

    def save_card_id(self, spotify_playlist_id: str, yoto_card_id: str) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO playlist_cards
                (spotify_playlist_id, yoto_card_id, updated_at)
                VALUES (?, ?, ?)
                """,
                (spotify_playlist_id, yoto_card_id, time.time()),
            )
            conn.commit()
        self._export_json()


def get_spotify_client() -> spotipy.Spotify:
    client_id = os.environ.get("SPOTIFY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        logger.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET")
        sys.exit(1)
    auth_manager = SpotifyClientCredentials(
        client_id=client_id,
        client_secret=client_secret
    )
    return spotipy.Spotify(auth_manager=auth_manager)


def fetch_playlist_tracks(sp: spotipy.Spotify, playlist_id: str) -> Dict[str, Any]:
    """Fetch playlist metadata and all tracks (handling Spotify pagination)."""
    playlist = sp.playlist(playlist_id)
    tracks_response = playlist["tracks"]
    items = list(tracks_response["items"])

    while tracks_response.get("next"):
        tracks_response = sp.next(tracks_response)
        items.extend(tracks_response.get("items", []))

    parsed_tracks: List[Dict[str, Any]] = []
    for item in items:
        track = item.get("track")
        if not track or not track.get("id"):
            continue
        artists = track.get("artists") or [{"name": "Unknown Artist"}]
        duration_ms = track.get("duration_ms") or 0
        parsed_tracks.append(
            {
                "id": track["id"],
                "name": track.get("name", "Untitled Track"),
                "artist": artists[0].get("name", "Unknown Artist"),
                "album": (track.get("album") or {}).get("name", ""),
                "duration_sec": max(1, int(round(duration_ms / 1000))),
                "spotify_url": f"https://open.spotify.com/track/{track['id']}",
            }
        )

    return {
        "id": playlist["id"],
        "name": playlist.get("name", "Synced Spotify Playlist"),
        "description": playlist.get("description", ""),
        "images": playlist.get("images", []),
        "tracks": parsed_tracks,
    }


def prepare_zotify_credentials() -> Optional[Path]:
    """Write ZOTIFY_CREDENTIALS_JSON env var to disk if provided."""
    creds_json = os.environ.get("ZOTIFY_CREDENTIALS_JSON")
    if creds_json:
        ZOTIFY_CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
        ZOTIFY_CREDENTIALS_PATH.write_text(creds_json, encoding="utf-8")
        return ZOTIFY_CREDENTIALS_PATH
    if ZOTIFY_CREDENTIALS_PATH.exists():
        return ZOTIFY_CREDENTIALS_PATH
    return None


def download_track_with_zotify(track: Dict[str, Any], creds_path: Optional[Path]) -> Optional[Path]:
    """
    Download a single Spotify track via Zotify (librespot-python) as a high-quality MP3
    (320kbps / very_high).
    """
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target_path = AUDIO_DIR / f"{track['id']}.mp3"
    if target_path.exists() and target_path.stat().st_size > 0:
        logger.info(f"Local MP3 already exists for {track['name']} ({track['id']})")
        return target_path

    tmp_dir = AUDIO_DIR / f"_tmp_{track['id']}"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "zotify",
        track["spotify_url"],
        "--root-path",
        str(tmp_dir),
        "--output",
        "{song_name}.{ext}",
        "--audio-format",
        "mp3",
        "--download-quality",
        "very_high",
        "--download-real-time",
        "False",
    ]

    if creds_path and creds_path.exists():
        cmd.extend(["--credentials-location", str(creds_path)])
    else:
        spotify_user = os.environ.get("SPOTIFY_USERNAME")
        spotify_pass = os.environ.get("SPOTIFY_PASSWORD")
        if spotify_user and spotify_pass:
            cmd.extend(["--username", spotify_user, "--password", spotify_pass])

    logger.info(f"Downloading via Zotify (librespot): {track['name']} - {track['artist']}")
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            logger.warning(f"Zotify exited with status {result.returncode}: {result.stderr.strip()}")

        downloaded_files = [
            Path(p) for p in glob.glob(str(tmp_dir / "**" / "*.mp3"), recursive=True)
        ]
        if not downloaded_files:
            logger.error(f"Zotify did not produce an MP3 file for {track['name']} ({track['id']})")
            return None

        shutil.move(str(downloaded_files[0]), str(target_path))
        return target_path
    except Exception as exc:
        logger.error(f"Error invoking Zotify for {track['id']}: {exc}")
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


class YotoClient:
    """
    Implements the official Yoto Developer API 4-step upload and MYO playlist creation flow:
      1. GET /media/transcode/audio/uploadUrl
      2. PUT raw MP3 audio bytes to uploadUrl
      3. Poll GET /media/upload/{uploadId}/transcoded until transcodedSha256 is ready
      4. POST /content to create or update the MYO card playlist
    """

    def __init__(self, access_token: str, base_url: str = YOTO_API_BASE):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            }
        )

    def get_upload_url(self) -> Dict[str, str]:
        """Step 1: Request a pre-signed uploadUrl and uploadId."""
        url = f"{self.base_url}/media/transcode/audio/uploadUrl"
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        upload_info = data.get("upload") or data
        upload_url = upload_info.get("uploadUrl")
        upload_id = upload_info.get("uploadId")
        if not upload_url or not upload_id:
            raise RuntimeError(f"Unexpected /uploadUrl response: {data}")
        return {"uploadUrl": upload_url, "uploadId": upload_id}

    def put_audio_file(self, upload_url: str, file_path: Path) -> None:
        """Step 2: PUT binary audio file to the pre-signed uploadUrl."""
        with file_path.open("rb") as audio_file:
            resp = requests.put(
                upload_url,
                data=audio_file,
                headers={"Content-Type": "audio/mpeg"},
                timeout=300,
            )
            resp.raise_for_status()

    def poll_transcode_status(
        self,
        upload_id: str,
        poll_interval_sec: float = 3.0,
        max_attempts: int = 60,
    ) -> Dict[str, Any]:
        """Step 3: Poll transcode status until transcodedSha256 is returned."""
        url = f"{self.base_url}/media/upload/{upload_id}/transcoded?loudnorm=false"
        for attempt in range(1, max_attempts + 1):
            resp = self.session.get(url, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                transcode = data.get("transcode") or data
                sha256 = transcode.get("transcodedSha256")
                if sha256:
                    logger.info(f"Transcode complete for uploadId={upload_id} -> sha256={sha256}")
                    return transcode
            logger.info(
                f"Waiting for Yoto transcode (uploadId={upload_id}, attempt {attempt}/{max_attempts})..."
            )
            time.sleep(poll_interval_sec)

        raise TimeoutError(f"Timed out waiting for transcodedSha256 on uploadId={upload_id}")

    def upload_and_transcode_track(self, file_path: Path) -> Dict[str, Any]:
        """Executes Steps 1-3 for a single local MP3 file."""
        step1 = self.get_upload_url()
        upload_url = step1["uploadUrl"]
        upload_id = step1["uploadId"]

        logger.info(f"Uploading {file_path.name} to Yoto (uploadId={upload_id})...")
        self.put_audio_file(upload_url, file_path)

        return self.poll_transcode_status(upload_id)

    def upsert_myo_content(
        self,
        title: str,
        description: str,
        tracks_payload: List[Dict[str, Any]],
        card_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Step 4: POST /content to create or update the MYO playlist card."""
        chapter_tracks = []
        for idx, track in enumerate(tracks_payload, start=1):
            key = f"{idx:02d}"
            chapter_tracks.append(
                {
                    "key": key,
                    "title": track["title"],
                    "trackUrl": f"yoto:#{track['transcodedSha256']}",
                    "duration": track.get("duration", 0),
                    "fileSize": track.get("fileSize", 0),
                    "format": "aac",
                    "type": "audio",
                    "channels": "stereo",
                }
            )

        body: Dict[str, Any] = {
            "title": title,
            "metadata": {
                "description": description or f"Synced by Yotofy ({len(chapter_tracks)} tracks)",
            },
            "content": {
                "playbackType": "linear",
                "chapters": [
                    {
                        "key": "01",
                        "title": title,
                        "overlayLabel": "1",
                        "tracks": chapter_tracks,
                    }
                ],
            },
        }

        if card_id:
            body["cardId"] = card_id

        url = f"{self.base_url}/content"
        resp = self.session.post(
            url,
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()


def main() -> None:
    playlist_id = os.environ.get("SPOTIFY_PLAYLIST_ID")
    yoto_access_token = os.environ.get("YOTO_ACCESS_TOKEN")
    explicit_card_id = os.environ.get("YOTO_CARD_ID")

    if not playlist_id:
        logger.error("Missing SPOTIFY_PLAYLIST_ID environment variable")
        sys.exit(1)
    if not yoto_access_token:
        logger.error("Missing YOTO_ACCESS_TOKEN environment variable")
        sys.exit(1)

    cache = TrackSyncCache(CACHE_DB_PATH, CACHE_JSON_PATH)
    sp = get_spotify_client()
    yoto = YotoClient(access_token=yoto_access_token)
    creds_path = prepare_zotify_credentials()

    logger.info(f"Fetching Spotify playlist {playlist_id}...")
    playlist = fetch_playlist_tracks(sp, playlist_id)
    tracks = playlist["tracks"]
    logger.info(f"Found {len(tracks)} tracks in '{playlist['name']}'")

    synced_tracks_for_card: List[Dict[str, Any]] = []

    for track in tracks:
        track_id = track["id"]
        cached = cache.get_track(track_id)

        if cached and cached.get("transcodedSha256"):
            logger.info(
                f"[CACHE HIT] Skipping download & upload for '{track['name']}' "
                f"({track_id}) -> yoto:#{cached['transcodedSha256']}"
            )
            synced_tracks_for_card.append(
                {
                    "spotifyTrackId": track_id,
                    "title": cached.get("title") or track["name"],
                    "artist": cached.get("artist") or track["artist"],
                    "transcodedSha256": cached["transcodedSha256"],
                    "duration": cached.get("duration") or track["duration_sec"],
                    "fileSize": cached.get("fileSize") or 0,
                }
            )
            continue

        # Download MP3 via Zotify (librespot-python)
        mp3_path = download_track_with_zotify(track, creds_path)
        if not mp3_path or not mp3_path.exists():
            logger.error(f"Skipping '{track['name']}' ({track_id}) because download failed.")
            continue

        file_size = mp3_path.stat().st_size

        # Yoto 4-Step Upload (Steps 1-3: /uploadUrl -> PUT audio -> poll /transcoded)
        try:
            transcode_info = yoto.upload_and_transcode_track(mp3_path)
            sha256 = transcode_info["transcodedSha256"]
            transcoded_duration = (
                transcode_info.get("transcodedInfo", {}).get("duration")
                or track["duration_sec"]
            )
            transcoded_size = (
                transcode_info.get("transcodedInfo", {}).get("fileSize")
                or file_size
            )

            cache.save_track(
                spotify_track_id=track_id,
                transcoded_sha256=sha256,
                title=track["name"],
                artist=track["artist"],
                duration_sec=int(transcoded_duration),
                file_size=int(transcoded_size),
            )

            synced_tracks_for_card.append(
                {
                    "spotifyTrackId": track_id,
                    "title": track["name"],
                    "artist": track["artist"],
                    "transcodedSha256": sha256,
                    "duration": int(transcoded_duration),
                    "fileSize": int(transcoded_size),
                }
            )
        except Exception as exc:
            logger.error(f"Failed Yoto upload/transcode for '{track['name']}' ({track_id}): {exc}")

    if not synced_tracks_for_card:
        logger.error("No tracks available to publish to Yoto /content.")
        sys.exit(1)

    target_card_id = explicit_card_id or cache.get_card_id(playlist_id)
    logger.info(
        f"Publishing {len(synced_tracks_for_card)} tracks to Yoto MYO /content "
        f"(cardId={target_card_id or 'NEW'})..."
    )

    card_response = yoto.upsert_myo_content(
        title=playlist["name"],
        description=playlist["description"],
        tracks_payload=synced_tracks_for_card,
        card_id=target_card_id,
    )

    returned_card_id = (
        card_response.get("cardId")
        or (card_response.get("card") or {}).get("cardId")
        or target_card_id
    )
    if returned_card_id:
        cache.save_card_id(playlist_id, returned_card_id)
        logger.info(f"Successfully synced playlist '{playlist['name']}' to Yoto Card ID: {returned_card_id}")
    else:
        logger.info(f"Successfully synced playlist '{playlist['name']}' to Yoto.")


if __name__ == "__main__":
    main()