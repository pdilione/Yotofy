import os
import sys
import json
import time
import glob
import uuid
import shutil
import logging
import subprocess
import hashlib
import base64
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any
from urllib.parse import urlencode, urlparse, parse_qs

import requests
import spotipy
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from spotipy.oauth2 import SpotifyOAuth, SpotifyClientCredentials
from spotipy.cache_handler import CacheFileHandler

# Load environment variables from .env
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("yotofy-sync")

YOTO_API_BASE = os.environ.get("YOTO_API_BASE", "https://api.yotoplay.com").rstrip("/")
YOTO_AUTH_BASE = os.environ.get("YOTO_AUTH_BASE", "https://login.yotoplay.com").rstrip("/")
AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", "/music" if Path("/music").exists() else "public/audio"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data" if Path("/app/data").exists() else ("/data" if Path("/data").exists() else "data")))

STATE_FILE_PATH = Path(os.environ.get("STATE_FILE_PATH", str(DATA_DIR / "state.json")))
SPOTIFY_TOKEN_PATH = Path(os.environ.get("SPOTIFY_TOKEN_PATH", str(DATA_DIR / "spotify_token.json")))
YOTO_TOKEN_PATH = Path(os.environ.get("YOTO_TOKEN_PATH", str(DATA_DIR / "yoto_token.json")))
ZOTIFY_CREDENTIALS_PATH = Path(os.environ.get("ZOTIFY_CREDENTIALS_PATH", "/app/data/credentials.json"))
LOG_FILE_PATH = Path(os.environ.get("LOG_FILE_PATH", str(DATA_DIR / "yotofy.log")))
ROOT_DIR = Path(__file__).resolve().parent.parent
_default_dist = ROOT_DIR / "dist" if (ROOT_DIR / "dist").exists() else Path("dist")
DIST_DIR = Path(os.environ.get("FRONTEND_DIST_DIR", str(_default_dist)))

SYSTEM_LOG_BUFFER: List[Dict[str, Any]] = []


class SystemLogBufferHandler(logging.Handler):
    """Captures all backend log records into an in-memory ring buffer and appends to /app/data/yotofy.log."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            ts = datetime.now(timezone.utc).isoformat()
            msg = record.getMessage()
            details = getattr(record, "details", None)
            entry: Dict[str, Any] = {
                "id": uuid.uuid4().hex[:10],
                "timestamp": ts,
                "level": record.levelname,
                "logger": record.name,
                "message": msg,
            }
            if details:
                entry["details"] = str(details)
            SYSTEM_LOG_BUFFER.insert(0, entry)
            del SYSTEM_LOG_BUFFER[300:]

            LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE_PATH.open("a", encoding="utf-8") as f:
                f.write(f"{ts} [{record.levelname}] {record.name}: {msg}\n")
                if details:
                    for line in str(details).splitlines():
                        f.write(f"    {line}\n")
        except Exception:
            pass


_buffer_handler = SystemLogBufferHandler()
logger.addHandler(_buffer_handler)


SPOTIFY_SCOPES = (
    "streaming playlist-read-private playlist-read-collaborative "
    "user-follow-read user-read-playback-position user-top-read "
    "user-read-recently-played user-library-read user-read-email user-read-private"
)
DEFAULT_SPOTIFY_REDIRECT_URI = os.environ.get(
    "SPOTIPY_REDIRECT_URI",
    "http://127.0.0.1:8000/api/auth/spotify/callback",
)
DEFAULT_YOTO_REDIRECT_URI = os.environ.get(
    "YOTO_REDIRECT_URI",
    "http://127.0.0.1:8000/api/auth/yoto/callback",
)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

DEFAULT_SETTINGS: Dict[str, Any] = {
    "audioProvider": "zotify",
    "syncFrequency": "hourly",
    "deploymentMode": "docker",
    "autoConversion": True,
    "notifications": True,
    "githubUser": "",
    "githubRepo": "yotofy",
    "yotoCardId": os.environ.get("YOTO_CARD_ID", ""),
}


class StateStore:
    """Persists sync history, track SHA-256 cache, playlist sync configs, activity logs, and settings in data/state.json."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_initialized()

    def _default_state(self) -> Dict[str, Any]:
        return {
            "tracks": {},
            "playlists": {},
            "activity": [],
            "settings": dict(DEFAULT_SETTINGS),
        }

    def _ensure_initialized(self) -> None:
        if not self.path.exists() or self.path.stat().st_size == 0:
            self.save(self._default_state())

    def load(self) -> Dict[str, Any]:
        self._ensure_initialized()
        try:
            raw = self.path.read_text(encoding="utf-8").strip()
            if not raw:
                default_st = self._default_state()
                self.save(default_st)
                return default_st
            data = json.loads(raw)
            if not isinstance(data, dict):
                default_st = self._default_state()
                self.save(default_st)
                return default_st
            data.setdefault("tracks", {})
            data.setdefault("playlists", {})
            data.setdefault("activity", [])
            data.setdefault("settings", dict(DEFAULT_SETTINGS))
            return data
        except Exception as exc:
            logger.warning(f"Failed to read {self.path}, resetting state: {exc}")
            default_st = self._default_state()
            try:
                self.save(default_st)
            except Exception:
                pass
            return default_st

    def save(self, state: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(state, indent=2)
        tmp_path = self.path.with_suffix(".json.tmp")
        try:
            tmp_path.write_text(serialized, encoding="utf-8")
            os.replace(str(tmp_path), str(self.path))
        except OSError:
            # Fallback if self.path is a direct single-file Docker bind mount (EBUSY on os.replace)
            self.path.write_text(serialized, encoding="utf-8")
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass

    def add_activity(
        self,
        playlist_name: str,
        message: str,
        log_type: str = "info",
        details: Optional[str] = None,
    ) -> Dict[str, Any]:
        state = self.load()
        entry: Dict[str, Any] = {
            "id": uuid.uuid4().hex[:10],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "playlistName": playlist_name,
            "message": message,
            "type": log_type,
        }
        if details:
            entry["details"] = details
        state["activity"] = [entry] + state.get("activity", [])[:99]
        self.save(state)
        return entry

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        state = self.load()
        return state.get("tracks", {}).get(track_id)

    def save_track(
        self,
        track_id: str,
        transcoded_sha256: str,
        title: str,
        artist: str,
        duration_sec: int,
        file_size: int,
        local_file_path: Optional[str] = None,
    ) -> None:
        state = self.load()
        state.setdefault("tracks", {})[track_id] = {
            "spotifyTrackId": track_id,
            "transcodedSha256": transcoded_sha256,
            "title": title,
            "artist": artist,
            "duration": duration_sec,
            "fileSize": file_size,
            "localFilePath": local_file_path,
            "syncedAt": datetime.now(timezone.utc).isoformat(),
        }
        self.save(state)


store = StateStore(STATE_FILE_PATH)


# =============================================================================
# Spotify OAuth 2.0 PKCE & SpotifyOAuth (data/spotify_token.json)
# =============================================================================
def get_spotify_credentials(override_client_id: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    state = store.load()
    saved_client_id = (state.get("settings") or {}).get("spotifyClientId")
    token_client_id = None
    if SPOTIFY_TOKEN_PATH.exists():
        try:
            tok = json.loads(SPOTIFY_TOKEN_PATH.read_text(encoding="utf-8"))
            token_client_id = tok.get("client_id")
        except Exception:
            pass

    client_id = (
        override_client_id
        or saved_client_id
        or token_client_id
        or os.environ.get("SPOTIPY_CLIENT_ID")
        or os.environ.get("SPOTIFY_CLIENT_ID")
    )
    client_secret = os.environ.get("SPOTIPY_CLIENT_SECRET") or os.environ.get("SPOTIFY_CLIENT_SECRET")
    return (
        client_id.strip() if isinstance(client_id, str) and client_id.strip() else None,
        client_secret.strip() if isinstance(client_secret, str) and client_secret.strip() else None,
    )


def get_valid_spotify_access_token(override_client_id: Optional[str] = None) -> Optional[str]:
    if not SPOTIFY_TOKEN_PATH.exists():
        return None
    try:
        token_data = json.loads(SPOTIFY_TOKEN_PATH.read_text(encoding="utf-8"))
        if not isinstance(token_data, dict) or not token_data.get("access_token"):
            return None

        expires_at = int(token_data.get("expires_at") or 0)
        now = int(time.time())
        if expires_at and now >= expires_at - 60 and token_data.get("refresh_token"):
            client_id, client_secret = get_spotify_credentials(override_client_id or token_data.get("client_id"))
            if client_id:
                payload: Dict[str, str] = {
                    "grant_type": "refresh_token",
                    "refresh_token": str(token_data["refresh_token"]),
                    "client_id": client_id,
                }
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                if client_secret and not token_data.get("pkce"):
                    sp_oauth = build_spotify_oauth(client_id_override=client_id)
                    if sp_oauth is not None:
                        refreshed = sp_oauth.validate_token(token_data)
                        if refreshed and refreshed.get("access_token"):
                            return str(refreshed["access_token"])
                else:
                    resp = requests.post(
                        "https://accounts.spotify.com/api/token",
                        data=payload,
                        headers=headers,
                        timeout=20,
                    )
                    if resp.status_code == 200:
                        refreshed = resp.json()
                        merged = {
                            **token_data,
                            **refreshed,
                            "client_id": client_id,
                            "refresh_token": refreshed.get("refresh_token", token_data["refresh_token"]),
                            "expires_at": int(time.time()) + int(refreshed.get("expires_in", 3600)),
                        }
                        SPOTIFY_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
                        SPOTIFY_TOKEN_PATH.write_text(json.dumps(merged, indent=2), encoding="utf-8")
                        return str(merged["access_token"])

        return str(token_data["access_token"])
    except Exception as exc:
        logger.warning(f"Failed to read/refresh Spotify token: {exc}")
        return None


def build_spotify_oauth(
    redirect_uri: Optional[str] = None,
    client_id_override: Optional[str] = None,
) -> Optional[SpotifyOAuth]:
    client_id, client_secret = get_spotify_credentials(client_id_override)
    if not client_id or not client_secret:
        return None
    SPOTIFY_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    cache_handler = CacheFileHandler(cache_path=str(SPOTIFY_TOKEN_PATH))
    return SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri or DEFAULT_SPOTIFY_REDIRECT_URI,
        scope=SPOTIFY_SCOPES,
        cache_handler=cache_handler,
        open_browser=False,
        show_dialog=True,
    )


def create_spotify_client(override_client_id: Optional[str] = None) -> Optional[spotipy.Spotify]:
    """
    Returns an authenticated Spotipy client using cached OAuth PKCE or SpotifyOAuth
    tokens in data/spotify_token.json (refreshing automatically if expired).
    """
    access_token = get_valid_spotify_access_token(override_client_id)
    if access_token:
        return spotipy.Spotify(auth=access_token)

    return None


def get_spotify_user_profile(override_client_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    access_token = get_valid_spotify_access_token(override_client_id)
    if not access_token:
        return None
    try:
        sp = spotipy.Spotify(auth=access_token)
        me = sp.current_user()
        if not me:
            return None
        images = me.get("images") or []
        return {
            "id": me.get("id"),
            "display_name": me.get("display_name") or me.get("id") or "Spotify User",
            "avatar": images[0]["url"] if images else None,
            "email": me.get("email"),
        }
    except Exception as exc:
        logger.warning(f"Failed to fetch Spotify user profile: {exc}")
        return None


# =============================================================================
# Yoto OAuth 2.0 PKCE & Token Flow (data/yoto_token.json)
# =============================================================================
YOTO_PKCE_SCOPES = "user:content:manage family:library:manage"


def get_yoto_oauth_credentials(override_client_id: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    state = store.load()
    saved_client_id = (state.get("settings") or {}).get("yotoClientId")
    token_client_id = None
    if YOTO_TOKEN_PATH.exists():
        try:
            tok = json.loads(YOTO_TOKEN_PATH.read_text(encoding="utf-8"))
            token_client_id = tok.get("client_id")
        except Exception:
            pass

    client_id = (
        override_client_id
        or saved_client_id
        or token_client_id
        or os.environ.get("YOTO_CLIENT_ID")
    )
    client_secret = os.environ.get("YOTO_CLIENT_SECRET")
    return (
        client_id.strip() if isinstance(client_id, str) and client_id.strip() else None,
        client_secret.strip() if isinstance(client_secret, str) and client_secret.strip() else None,
    )


def load_yoto_token_data() -> Optional[Dict[str, Any]]:
    if not YOTO_TOKEN_PATH.exists():
        env_token = os.environ.get("YOTO_ACCESS_TOKEN")
        if env_token and env_token.strip():
            return {"access_token": env_token.strip(), "refresh_token": os.environ.get("YOTO_REFRESH_TOKEN")}
        return None
    try:
        data = json.loads(YOTO_TOKEN_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception as exc:
        logger.warning(f"Failed to read {YOTO_TOKEN_PATH}: {exc}")
        return None


def save_yoto_token_data(token_payload: Dict[str, Any]) -> Dict[str, Any]:
    YOTO_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    expires_in = token_payload.get("expires_in")
    if expires_in and "expires_at" not in token_payload:
        token_payload["expires_at"] = now + int(expires_in)
    token_payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    YOTO_TOKEN_PATH.write_text(json.dumps(token_payload, indent=2), encoding="utf-8")
    return token_payload


def refresh_yoto_token_if_needed(
    token_data: Dict[str, Any],
    override_client_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    expires_at = token_data.get("expires_at")
    now = int(time.time())
    if not expires_at or now < int(expires_at) - 60:
        return token_data

    refresh_token = token_data.get("refresh_token")
    client_id, client_secret = get_yoto_oauth_credentials(override_client_id or token_data.get("client_id"))
    if not refresh_token or not client_id:
        return token_data

    try:
        payload: Dict[str, str] = {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh_token,
        }
        if client_secret and not token_data.get("pkce"):
            payload["client_secret"] = client_secret

        resp = requests.post(
            f"{YOTO_AUTH_BASE}/oauth/token",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        resp.raise_for_status()
        refreshed = resp.json()
        merged = {
            **token_data,
            **refreshed,
            "client_id": client_id,
            "refresh_token": refreshed.get("refresh_token", refresh_token),
        }
        return save_yoto_token_data(merged)
    except Exception as exc:
        logger.warning(f"Failed to refresh Yoto token: {exc}")
        return token_data


def get_yoto_token(override_client_id: Optional[str] = None) -> Optional[str]:
    token_data = load_yoto_token_data()
    if not token_data:
        return None
    token_data = refresh_yoto_token_if_needed(token_data, override_client_id) or token_data
    access_token = token_data.get("access_token")
    return access_token.strip() if isinstance(access_token, str) and access_token.strip() else None


def enrich_card_with_local_state(card: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    sha_to_track: Dict[str, Dict[str, Any]] = {}
    for t in (state.get("tracks") or {}).values():
        if isinstance(t, dict) and t.get("transcodedSha256"):
            sha_to_track[str(t["transcodedSha256"])] = t

    linked_pl_id: Optional[str] = None
    linked_pl_name: Optional[str] = None
    for pl in (state.get("playlists") or {}).values():
        if isinstance(pl, dict) and (pl.get("syncConfig") or {}).get("targetYotoId") == card.get("cardId"):
            linked_pl_id = pl.get("id")
            linked_pl_name = pl.get("name")
            break

    enriched_tracks: List[Dict[str, Any]] = []
    for tr in card.get("tracks") or []:
        if not isinstance(tr, dict):
            continue
        track_url = str(tr.get("trackUrl") or "")
        sha = tr.get("transcodedSha256") or (track_url[6:] if track_url.startswith("yoto:#") else None)
        matched = sha_to_track.get(sha) if sha else None
        enriched_tracks.append(
            {
                **tr,
                "transcodedSha256": sha,
                "artist": tr.get("artist") or (matched.get("artist") if matched else None),
                "spotifyTrackId": tr.get("spotifyTrackId") or (matched.get("spotifyTrackId") if matched else None),
                "duration": tr.get("duration") or (matched.get("duration") if matched else None),
                "fileSize": tr.get("fileSize") or (matched.get("fileSize") if matched else None),
            }
        )

    out = dict(card)
    if enriched_tracks:
        out["tracks"] = enriched_tracks
        out["trackCount"] = out.get("trackCount") or len(enriched_tracks)
    if linked_pl_id and not out.get("linkedSpotifyPlaylistId"):
        out["linkedSpotifyPlaylistId"] = linked_pl_id
    if linked_pl_name and not out.get("linkedSpotifyPlaylistName"):
        out["linkedSpotifyPlaylistName"] = linked_pl_name
    return out


def parse_single_yoto_card(item: Dict[str, Any], state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    raw = item.get("card") if isinstance(item.get("card"), dict) else item
    card_id = str(raw.get("cardId") or raw.get("id") or raw.get("_id") or "")
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    content = raw.get("content") if isinstance(raw.get("content"), dict) else {}
    raw_chapters = content.get("chapters") if isinstance(content.get("chapters"), list) else []

    chapters: List[Dict[str, Any]] = []
    flat_tracks: List[Dict[str, Any]] = []
    total_duration = 0

    for c_idx, ch in enumerate(raw_chapters, start=1):
        if not isinstance(ch, dict):
            continue
        raw_tracks = ch.get("tracks") if isinstance(ch.get("tracks"), list) else []
        parsed_ch_tracks: List[Dict[str, Any]] = []
        for t_idx, t in enumerate(raw_tracks, start=1):
            if not isinstance(t, dict):
                continue
            track_url = str(t.get("trackUrl")) if t.get("trackUrl") else None
            sha = track_url[6:] if track_url and track_url.startswith("yoto:#") else None
            dur = t.get("duration") if isinstance(t.get("duration"), (int, float)) else None
            if dur:
                total_duration += int(dur)
            tr_obj = {
                "key": str(t.get("key") or f"{t_idx:02d}"),
                "title": str(t.get("title") or ch.get("title") or f"Track {t_idx}"),
                "trackUrl": track_url,
                "transcodedSha256": sha,
                "duration": int(dur) if dur is not None else None,
                "fileSize": int(t["fileSize"]) if isinstance(t.get("fileSize"), (int, float)) else None,
                "format": str(t["format"]) if t.get("format") else None,
                "channels": str(t["channels"]) if t.get("channels") else None,
            }
            parsed_ch_tracks.append(tr_obj)
            flat_tracks.append(tr_obj)

        chapters.append(
            {
                "key": str(ch.get("key") or f"{c_idx:02d}"),
                "title": str(ch.get("title") or f"Chapter {c_idx}"),
                "duration": int(ch["duration"]) if isinstance(ch.get("duration"), (int, float)) else None,
                "fileSize": int(ch["fileSize"]) if isinstance(ch.get("fileSize"), (int, float)) else None,
                "tracks": parsed_ch_tracks,
            }
        )

    cover_obj = metadata.get("cover") if isinstance(metadata.get("cover"), dict) else {}
    cover_url = (
        cover_obj.get("imageL")
        or cover_obj.get("imageM")
        or cover_obj.get("imageS")
        or raw.get("coverImageUrl")
    )
    media_obj = metadata.get("media") if isinstance(metadata.get("media"), dict) else {}
    media_duration = int(media_obj["duration"]) if isinstance(media_obj.get("duration"), (int, float)) else None

    base_card: Dict[str, Any] = {
        "cardId": card_id,
        "title": str(raw.get("title") or metadata.get("title") or f"MYO Card {card_id}"),
        "description": metadata.get("description") or raw.get("description"),
        "coverImageUrl": cover_url,
        "trackCount": len(flat_tracks) or raw.get("trackCount") or len(chapters) or None,
        "chapterCount": len(chapters) or raw.get("chapterCount") or None,
        "totalDuration": total_duration or media_duration or raw.get("totalDuration") or None,
        "playbackType": content.get("playbackType") or raw.get("playbackType"),
        "updatedAt": raw.get("updatedAt"),
        "createdAt": raw.get("createdAt"),
        "chapters": chapters if chapters else (raw.get("chapters") if isinstance(raw.get("chapters"), list) else None),
        "tracks": flat_tracks if flat_tracks else (raw.get("tracks") if isinstance(raw.get("tracks"), list) else None),
    }
    return enrich_card_with_local_state(base_card, state) if state else base_card


def parse_yoto_mine_cards(raw: Any, state: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    raw_list: List[Any] = []
    if isinstance(raw, list):
        raw_list = raw
    elif isinstance(raw, dict):
        if isinstance(raw.get("cards"), list):
            raw_list = raw["cards"]
        elif isinstance(raw.get("content"), list):
            raw_list = raw["content"]

    cards_out: List[Dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        card_id = item.get("cardId") or item.get("id") or item.get("_id")
        if not card_id:
            continue
        cards_out.append(parse_single_yoto_card(item, state))
    return cards_out


def verify_yoto_connection_via_mine(
    override_client_id: Optional[str] = None,
) -> tuple[bool, Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    access_token = get_yoto_token(override_client_id)
    token_data = load_yoto_token_data() or {}
    state = store.load()
    cached_cards: List[Dict[str, Any]] = [
        parse_single_yoto_card(c, state)
        for c in (token_data.get("cards") or [])
        if isinstance(c, dict)
    ]
    cached_profile: Optional[Dict[str, Any]] = (
        token_data.get("profile")
        if isinstance(token_data.get("profile"), dict)
        else (
            token_data.get("user")
            if isinstance(token_data.get("user"), dict)
            else (
                {
                    "id": "yoto-user",
                    "display_name": f"Yoto Library ({len(cached_cards)} MYO Cards)",
                    "avatar": None,
                    "cardCount": len(cached_cards),
                }
                if cached_cards
                else None
            )
        )
    )

    if not access_token:
        return bool(cached_cards), cached_profile, cached_cards

    try:
        resp = requests.get(
            f"{YOTO_API_BASE}/content/mine",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            timeout=15,
        )
        if resp.status_code != 200:
            if cached_cards:
                return True, cached_profile, cached_cards
            return False, None, []

        mine_json = resp.json()
        cards = parse_yoto_mine_cards(mine_json, state)

        profile = token_data.get("profile") if isinstance(token_data.get("profile"), dict) else {}
        display_name = profile.get("display_name") or ""
        avatar = profile.get("avatar")
        user_id = profile.get("id") or "yoto-user"

        if not display_name or display_name == "Yoto Account":
            try:
                u_resp = requests.get(
                    f"{YOTO_AUTH_BASE}/userinfo",
                    headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
                    timeout=10,
                )
                if u_resp.status_code == 200:
                    u = u_resp.json()
                    display_name = (
                        u.get("name")
                        or u.get("nickname")
                        or u.get("preferred_username")
                        or u.get("email")
                        or u.get("sub")
                        or ""
                    )
                    avatar = u.get("picture") or u.get("avatar")
                    user_id = u.get("sub") or u.get("id") or user_id
            except Exception:
                pass

        user_profile: Dict[str, Any] = {
            "id": user_id,
            "display_name": str(display_name or f"Yoto Library ({len(cards)} MYO Cards)"),
            "avatar": avatar,
            "cardCount": len(cards),
        }

        if YOTO_TOKEN_PATH.exists():
            token_data["profile"] = user_profile
            token_data["cards"] = cards
            save_yoto_token_data(token_data)

        return True, user_profile, cards
    except Exception as exc:
        logger.warning(f"Failed to verify Yoto connection via /content/mine: {exc}")
        if cached_cards:
            return True, cached_profile, cached_cards
        return False, None, []



def format_duration_ms(duration_ms: int) -> str:
    total_sec = max(0, int(round((duration_ms or 0) / 1000)))
    minutes = total_sec // 60
    seconds = total_sec % 60
    return f"{minutes}:{seconds:02d}"


def build_playlist_payload(raw_pl: Dict[str, Any], sp: spotipy.Spotify, state: Dict[str, Any]) -> Dict[str, Any]:
    pl_id = raw_pl["id"]
    tracks_map = state.get("tracks", {})
    saved_pl = state.get("playlists", {}).get(pl_id, {})

    tracks_container = raw_pl.get("tracks", {})
    items = tracks_container.get("items")
    if items is None:
        full_pl = sp.playlist(pl_id)
        tracks_container = full_pl.get("tracks", {})
        items = list(tracks_container.get("items", []))
    else:
        items = list(items)

    while tracks_container.get("next"):
        tracks_container = sp.next(tracks_container)
        items.extend(tracks_container.get("items", []))

    parsed_tracks: List[Dict[str, Any]] = []
    for item in items:
        track = item.get("track") if isinstance(item, dict) else None
        if not track or not track.get("id"):
            continue
        tid = track["id"]
        artists = track.get("artists") or [{"name": "Unknown Artist"}]
        album_obj = track.get("album") or {}
        album_images = album_obj.get("images") or []
        pl_images = raw_pl.get("images") or []
        image_url = (
            (album_images[0]["url"] if album_images else None)
            or (pl_images[0]["url"] if pl_images else "")
        )

        cached_entry = tracks_map.get(tid)
        is_cached = bool(cached_entry and cached_entry.get("transcodedSha256"))

        parsed_tracks.append(
            {
                "id": tid,
                "title": track.get("name", "Untitled"),
                "artist": artists[0].get("name", "Unknown Artist"),
                "album": album_obj.get("name", ""),
                "duration": format_duration_ms(track.get("duration_ms") or 0),
                "durationSec": max(1, int(round((track.get("duration_ms") or 0) / 1000))),
                "imageUrl": image_url,
                "inLocalCache": is_cached,
                "zotifyStatus": "cached" if is_cached else "pending",
                "yotoTranscodeStatus": "transcoded" if is_cached else "idle",
                "transcodedSha256": cached_entry.get("transcodedSha256") if cached_entry else None,
                "localFilePath": cached_entry.get("localFilePath") if cached_entry else None,
                "fileSize": cached_entry.get("fileSize") if cached_entry else None,
                "syncedAt": cached_entry.get("syncedAt") if cached_entry else None,
            }
        )

    pl_images = raw_pl.get("images") or []
    result: Dict[str, Any] = {
        "id": pl_id,
        "name": raw_pl.get("name", "Untitled Playlist"),
        "description": raw_pl.get("description") or "",
        "trackCount": len(parsed_tracks) or (raw_pl.get("tracks") or {}).get("total", 0),
        "imageUrl": pl_images[0]["url"] if pl_images else "",
        "tracks": parsed_tracks,
    }

    if saved_pl.get("syncConfig"):
        result["syncConfig"] = saved_pl["syncConfig"]
    if saved_pl.get("generatedIcon"):
        result["generatedIcon"] = saved_pl["generatedIcon"]
    if saved_pl.get("themeColor"):
        result["themeColor"] = saved_pl["themeColor"]

    return result


ZOTIFY_KEYMASTER_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd"
ZOTIFY_KEYMASTER_REDIRECT_URI = "http://127.0.0.1:4381/login"
ZOTIFY_KEYMASTER_SCOPES = (
    "streaming playlist-read-private playlist-read-collaborative "
    "user-follow-read user-read-playback-position user-top-read "
    "user-read-recently-played user-library-read user-read-email user-read-private"
)
ZOTIFY_PKCE_STATE_PATH = DATA_DIR / "zotify_pkce.json"
_LAST_ZOTIFY_CODE_VERIFIER: Optional[str] = None


def inspect_and_normalize_zotify_credentials(path: Path) -> Dict[str, Any]:
    """
    Validates a Zotify Login5 credentials.json file and automatically upgrades
    legacy librespot keys ('auth_data' / 'auth_type') to Googolplexed0/zotify's
    required keys ('credentials' / 'type').
    """
    exists = path.exists() and path.is_file()
    size = path.stat().st_size if exists else 0
    if not exists or size == 0:
        return {
            "exists": exists,
            "valid": False,
            "path": str(path),
            "size": size,
            "error": "Credentials file is missing or empty (0 bytes).",
        }

    try:
        raw_text = path.read_text(encoding="utf-8", errors="replace").strip()
        data = json.loads(raw_text)
        if not isinstance(data, dict):
            return {
                "exists": True,
                "valid": False,
                "path": str(path),
                "size": size,
                "error": "Credentials file is not a JSON object.",
            }

        changed = False
        if not data.get("credentials") and data.get("auth_data"):
            data["credentials"] = data["auth_data"]
            changed = True

        cred_type = data.get("type") or data.get("auth_type")
        if cred_type in (4, "4", "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS", None) and data.get("credentials"):
            if data.get("type") != "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS":
                data["type"] = "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS"
                changed = True

        if changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            size = path.stat().st_size

        username = str(data.get("username") or "").strip()
        credentials_b64 = str(data.get("credentials") or "").strip()
        final_type = str(data.get("type") or "").strip()

        if final_type == "OAUTH_PKCE_TOKEN" and data.get("access_token"):
            return {
                "exists": True,
                "valid": True,
                "username": username or "OAuth PKCE Token",
                "type": final_type,
                "path": str(path),
                "size": size,
            }

        if not username or not credentials_b64 or final_type != "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS":
            return {
                "exists": True,
                "valid": False,
                "path": str(path),
                "size": size,
                "error": (
                    "Invalid Zotify credentials format: expected keys "
                    "'username', 'credentials', and 'type': 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'."
                ),
            }

        return {
            "exists": True,
            "valid": True,
            "username": username,
            "type": final_type,
            "path": str(path),
            "size": size,
        }
    except Exception as exc:
        return {
            "exists": True,
            "valid": False,
            "path": str(path),
            "size": size,
            "error": f"Failed to parse credentials.json: {exc}",
        }


def _mirror_credentials_file(source_path: Path) -> None:
    """Ensures /app/data/credentials.json and /data/credentials.json stay in sync when both paths exist."""
    if not source_path.exists() or source_path.stat().st_size == 0:
        return
    for mirror in (ZOTIFY_CREDENTIALS_PATH, DATA_DIR / "credentials.json", Path("/app/data/credentials.json"), Path("/data/credentials.json")):
        try:
            if mirror.parent.exists() and mirror.resolve() != source_path.resolve():
                shutil.copyfile(str(source_path), str(mirror))
        except Exception:
            pass


def bootstrap_zotify_login5_from_access_token(access_token: str, target_path: Path) -> Dict[str, Any]:
    """
    Uses Googolplexed0/librespot-python in a clean subprocess to exchange a Spotify
    OAuth access_token for reusable AP credentials (ap_welcome.reusable_auth_credentials)
    and saves them to target_path. Bridges TokenProvider.login5 with the OAuth token so
    non-Keymaster PKCE tokens do not crash during DealerClient.connect().
    """
    target_path.parent.mkdir(parents=True, exist_ok=True)
    helper_code = (
        "import json, os, sys\n"
        "from librespot.core import Session, TokenProvider, DealerClient\n"
        "from librespot.proto import Authentication_pb2 as Authentication\n"
        "token = os.environ['ZOTIFY_BOOT_TOKEN']\n"
        "out_path = os.environ['ZOTIFY_BOOT_OUT']\n"
        "_orig_login5 = TokenProvider.login5\n"
        "def _patched_login5(self, scopes):\n"
        "    try:\n"
        "        res = _orig_login5(self, scopes)\n"
        "        if res is not None:\n"
        "            return res\n"
        "    except Exception:\n"
        "        pass\n"
        "    return TokenProvider.StoredToken({\n"
        "        'expiresIn': 3600,\n"
        "        'accessToken': token,\n"
        "        'scope': list(scopes) if scopes else ['playlist-read'],\n"
        "    })\n"
        "TokenProvider.login5 = _patched_login5\n"
        "_orig_dealer_connect = DealerClient.connect\n"
        "def _safe_dealer_connect(self):\n"
        "    try:\n"
        "        return _orig_dealer_connect(self)\n"
        "    except Exception:\n"
        "        return None\n"
        "DealerClient.connect = _safe_dealer_connect\n"
        "builder = Session.Builder()\n"
        "builder.conf.store_credentials = False\n"
        "builder.login_credentials = Authentication.LoginCredentials(\n"
        "    typ=Authentication.AuthenticationType.AUTHENTICATION_SPOTIFY_TOKEN,\n"
        "    auth_data=token.encode('utf-8')\n"
        ")\n"
        "session = builder.create()\n"
        "creds = session.credentials()\n"
        "with open(out_path, 'w', encoding='utf-8') as f:\n"
        "    json.dump(creds, f, indent=2)\n"
        "print(json.dumps({'username': creds.get('username'), 'type': creds.get('type')}))\n"
        "sys.stdout.flush()\n"
        "os._exit(0)\n"
    )
    env = {
        **os.environ,
        "PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION": "python",
        "ZOTIFY_BOOT_TOKEN": access_token,
        "ZOTIFY_BOOT_OUT": str(target_path),
    }
    res = subprocess.run(
        [sys.executable, "-c", helper_code],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )
    if res.returncode != 0:
        err_out = (res.stderr or res.stdout or "").strip()
        raise RuntimeError(f"librespot Session.Builder().create() failed (exit={res.returncode}): {err_out}")
    status = inspect_and_normalize_zotify_credentials(target_path)
    if not status.get("valid"):
        raise RuntimeError(status.get("error") or "Generated credentials.json failed validation.")
    _mirror_credentials_file(target_path)
    return status


def prepare_zotify_credentials() -> Path:
    creds_json = os.environ.get("ZOTIFY_CREDENTIALS_JSON")
    if creds_json and creds_json.strip():
        ZOTIFY_CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
        ZOTIFY_CREDENTIALS_PATH.write_text(creds_json.strip(), encoding="utf-8")
        inspect_and_normalize_zotify_credentials(ZOTIFY_CREDENTIALS_PATH)
        _mirror_credentials_file(ZOTIFY_CREDENTIALS_PATH)
        return ZOTIFY_CREDENTIALS_PATH

    candidate_paths = [
        ZOTIFY_CREDENTIALS_PATH,
        DATA_DIR / "credentials.json",
        Path("/app/data/credentials.json"),
        Path("/data/credentials.json"),
        Path.home() / ".config" / "zotify" / "credentials.json",
        Path.home() / ".local" / "share" / "zotify" / "credentials.json",
    ]
    for cand in candidate_paths:
        try:
            info = inspect_and_normalize_zotify_credentials(cand)
            if info.get("valid"):
                if cand.resolve() != ZOTIFY_CREDENTIALS_PATH.resolve():
                    ZOTIFY_CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(str(cand), str(ZOTIFY_CREDENTIALS_PATH))
                _mirror_credentials_file(ZOTIFY_CREDENTIALS_PATH)
                return ZOTIFY_CREDENTIALS_PATH
        except Exception:
            continue

    # Programmatic fallback: if credentials.json is still missing/invalid and spotify_token.json exists,
    # refresh the active Spotify OAuth access_token and exchange it for reusable AP credentials automatically.
    acc_tok = get_valid_spotify_access_token()
    if acc_tok:
        try:
            status = bootstrap_zotify_login5_from_access_token(acc_tok, ZOTIFY_CREDENTIALS_PATH)
            logger.info(
                f"Auto-provisioned {ZOTIFY_CREDENTIALS_PATH} from existing Spotify OAuth token (user: {status.get('username')})."
            )
        except Exception as exc:
            logger.warning(f"Auto-bootstrap of {ZOTIFY_CREDENTIALS_PATH} from spotify_token.json failed: {exc}")

    return ZOTIFY_CREDENTIALS_PATH


ZOTIFY_RUNNER_WRAPPER = (
    "import json, os, sys\n"
    "try:\n"
    "    from librespot.core import TokenProvider, DealerClient\n"
    "    _orig_login5 = TokenProvider.login5\n"
    "    def _patched_login5(self, scopes):\n"
    "        try:\n"
    "            res = _orig_login5(self, scopes)\n"
    "            if res is not None:\n"
    "                return res\n"
    "        except Exception:\n"
    "            pass\n"
    "        fb = os.environ.get('ZOTIFY_FALLBACK_ACCESS_TOKEN', '').strip()\n"
    "        if not fb:\n"
    "            tok_path = os.environ.get('SPOTIFY_TOKEN_PATH', '/app/data/spotify_token.json')\n"
    "            if os.path.exists(tok_path):\n"
    "                try:\n"
    "                    fb = json.load(open(tok_path, 'r', encoding='utf-8')).get('access_token', '').strip()\n"
    "                except Exception:\n"
    "                    pass\n"
    "        if fb:\n"
    "            return TokenProvider.StoredToken({\n"
    "                'expiresIn': 3600,\n"
    "                'accessToken': fb,\n"
    "                'scope': list(scopes) if scopes else ['playlist-read'],\n"
    "            })\n"
    "        return None\n"
    "    TokenProvider.login5 = _patched_login5\n"
    "    _orig_dealer_connect = DealerClient.connect\n"
    "    def _safe_dealer_connect(self):\n"
    "        try:\n"
    "            return _orig_dealer_connect(self)\n"
    "        except Exception:\n"
    "            return None\n"
    "    DealerClient.connect = _safe_dealer_connect\n"
    "except Exception:\n"
    "    pass\n"
    "from zotify.__main__ import main\n"
    "sys.argv = ['zotify'] + sys.argv[1:]\n"
    "main()\n"
)


def download_track_with_zotify(
    track_id: str,
    track_title: str,
    creds_path: Optional[Path] = None,
) -> tuple[Optional[Path], str]:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target_path = AUDIO_DIR / f"{track_id}.mp3"
    if target_path.exists() and target_path.stat().st_size > 0:
        size_kb = target_path.stat().st_size // 1024
        msg = f"Using existing local MP3 cache: {target_path} ({size_kb} KB)"
        logger.info(msg)
        return target_path, msg

    creds_file_obj = creds_path or prepare_zotify_credentials()
    cred_status = inspect_and_normalize_zotify_credentials(creds_file_obj)
    if not cred_status.get("valid"):
        # Try one more time via prepare_zotify_credentials in case spotify_token.json can bootstrap it now
        creds_file_obj = prepare_zotify_credentials()
        cred_status = inspect_and_normalize_zotify_credentials(creds_file_obj)

    credentials_file = str(creds_file_obj)
    creds_exists = cred_status["exists"]
    creds_size = cred_status["size"]

    if not cred_status.get("valid"):
        missing_diag = (
            f"Track: '{track_title}' ({track_id})\n"
            f"Credentials: {credentials_file} (exists={creds_exists}, size={creds_size}B, valid=False)\n"
            f"Reason: {cred_status.get('error')}\n"
            f"Resolution: Headless Docker containers cannot complete Zotify's interactive 127.0.0.1:4381 login automatically.\n"
            f"Open 'Config' or 'Logs' in the Yotofy Web UI and use the 'Zotify Login5 Credential Generator' "
            f"to authenticate and save {credentials_file} in 2 clicks."
        )
        logger.error(
            f"Zotify aborted for '{track_title}' ({track_id}): {cred_status.get('error')}",
            extra={"details": missing_diag},
        )
        return None, missing_diag

    tmp_dir = AUDIO_DIR / f"_tmp_{track_id}"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    zotify_args = [
        f"https://open.spotify.com/track/{track_id}",
        "--config-location",
        str(DATA_DIR),
        "--credentials-location",
        credentials_file,
        "--root-path",
        str(tmp_dir),
        "--output",
        "{song_name}",
        "--download-format",
        "mp3",
        "--download-quality",
        "very_high",
        "--lyrics-to-file",
        "False",
        "--lyrics-to-metadata",
        "False",
        "--disable-song-archive",
        "True",
        "--disable-directory-archives",
        "True",
        "--skip-previously-downloaded",
        "False",
        "--standard-interface",
        "True",
        "--redirect-timeout",
        "1.0",
        "--retry-attempts",
        "0",
    ]
    cmd = [sys.executable, "-c", ZOTIFY_RUNNER_WRAPPER, *zotify_args]
    cmd_str = f"{sys.executable} -m zotify " + " ".join(zotify_args)

    fallback_access_token = get_valid_spotify_access_token() or ""

    logger.info(
        f"Downloading '{track_title}' ({track_id}) via Googolplexed0/zotify...",
        extra={
            "details": (
                f"Command: {cmd_str}\n"
                f"Credentials: {credentials_file} (user={cred_status.get('username')}, size={creds_size}B)\n"
                f"OAuth Token Bridge: {'enabled' if fallback_access_token else 'none'}\n"
                f"Temp Dir: {tmp_dir}"
            )
        },
    )

    try:
        env = {
            **os.environ,
            "PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION": "python",
            "ZOTIFY_FALLBACK_ACCESS_TOKEN": fallback_access_token,
            "SPOTIFY_TOKEN_PATH": str(SPOTIFY_TOKEN_PATH),
        }
        res = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            timeout=180,
            check=False,
        )
        stdout_text = (res.stdout or "").strip()
        stderr_text = (res.stderr or "").strip()
        all_files = [
            str(Path(p).relative_to(tmp_dir))
            for p in glob.glob(str(tmp_dir / "**" / "*"), recursive=True)
            if Path(p).is_file()
        ]
        mp3_files = [Path(p) for p in glob.glob(str(tmp_dir / "**" / "*.mp3"), recursive=True)]

        diag_lines = [
            f"Track: '{track_title}' ({track_id})",
            f"Exit Code: {res.returncode}",
            f"Credentials: {credentials_file} (user={cred_status.get('username')}, size={creds_size}B)",
            f"Command: {cmd_str}",
            f"Files in tmp_dir: {all_files if all_files else 'none'}",
        ]
        if stdout_text:
            diag_lines.append(f"STDOUT:\n{stdout_text}")
        else:
            diag_lines.append("STDOUT: (empty)")
        if stderr_text:
            diag_lines.append(f"STDERR:\n{stderr_text}")
        else:
            diag_lines.append("STDERR: (empty)")
        diag_details = "\n".join(diag_lines)

        if not mp3_files:
            logger.error(
                f"Zotify produced no MP3 file for '{track_title}' ({track_id}) [exit={res.returncode}]",
                extra={"details": diag_details},
            )
            return None, diag_details

        shutil.move(str(mp3_files[0]), str(target_path))
        final_size = target_path.stat().st_size if target_path.exists() else 0
        success_diag = f"Saved MP3: {target_path} ({final_size // 1024} KB)\n" + diag_details
        logger.info(
            f"Zotify downloaded '{track_title}' ({track_id}) -> {final_size // 1024} KB",
            extra={"details": success_diag},
        )
        return target_path, success_diag
    except Exception as exc:
        err_diag = (
            f"Exception running Zotify for '{track_title}' ({track_id}): {exc}\n"
            f"Credentials: {credentials_file} (exists={creds_exists}, size={creds_size}B)\n"
            f"Command: {cmd_str}"
        )
        logger.error(f"Zotify download exception for {track_id}: {exc}", extra={"details": err_diag})
        return None, err_diag
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)




class YotoClient:
    """Official Yoto Developer API 4-step upload and MYO playlist creation client."""

    def __init__(self, access_token: str, base_url: str = YOTO_API_BASE):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            }
        )

    def get_upload_url(self) -> Dict[str, str]:
        resp = self.session.get(f"{self.base_url}/media/transcode/audio/uploadUrl", timeout=30)
        resp.raise_for_status()
        data = resp.json()
        upload = data.get("upload") or data
        return {"uploadUrl": upload["uploadUrl"], "uploadId": upload["uploadId"]}

    def put_audio_file(self, upload_url: str, file_path: Path) -> None:
        with file_path.open("rb") as f:
            resp = requests.put(
                upload_url,
                data=f,
                headers={"Content-Type": "audio/mpeg"},
                timeout=300,
            )
            resp.raise_for_status()

    def poll_transcode_status(self, upload_id: str, max_attempts: int = 60, interval: float = 3.0) -> Dict[str, Any]:
        url = f"{self.base_url}/media/upload/{upload_id}/transcoded?loudnorm=false"
        for _ in range(max_attempts):
            resp = self.session.get(url, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                transcode = data.get("transcode") or data
                if transcode.get("transcodedSha256"):
                    return transcode
            time.sleep(interval)
        raise TimeoutError(f"Timed out waiting for transcodedSha256 (uploadId={upload_id})")

    def upload_and_transcode_track(self, file_path: Path) -> Dict[str, Any]:
        step1 = self.get_upload_url()
        self.put_audio_file(step1["uploadUrl"], file_path)
        return self.poll_transcode_status(step1["uploadId"])

    def upsert_myo_content(
        self,
        title: str,
        description: str,
        tracks_payload: List[Dict[str, Any]],
        card_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        chapter_tracks = [
            {
                "key": f"{idx:02d}",
                "title": t["title"],
                "trackUrl": f"yoto:#{t['transcodedSha256']}",
                "duration": t.get("duration", 0),
                "fileSize": t.get("fileSize", 0),
                "format": "aac",
                "type": "audio",
                "channels": "stereo",
            }
            for idx, t in enumerate(tracks_payload, start=1)
        ]
        body: Dict[str, Any] = {
            "title": title,
            "metadata": {"description": description or f"Synced by Yotofy ({len(chapter_tracks)} tracks)"},
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

        resp = self.session.post(
            f"{self.base_url}/content",
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()


# =============================================================================
# FastAPI Server Definition
# =============================================================================
app = FastAPI(title="Yotofy Sync API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SyncRequest(BaseModel):
    playlistId: str
    autoSync: Optional[bool] = True
    targetYotoId: Optional[str] = None
    createNew: Optional[bool] = False
    customTitle: Optional[str] = None
    spotifyClientId: Optional[str] = None
    yotoClientId: Optional[str] = None


class SettingsUpdateRequest(BaseModel):
    audioProvider: str = "zotify"
    syncFrequency: str = "hourly"
    deploymentMode: str = "docker"
    autoConversion: bool = True
    notifications: bool = True
    githubUser: str = ""
    githubRepo: str = "yotofy"
    yotoCardId: Optional[str] = ""
    spotifyClientId: Optional[str] = ""
    yotoClientId: Optional[str] = ""


class SpotifyPkceRequest(BaseModel):
    code: str
    codeVerifier: str
    redirectUri: str
    clientId: Optional[str] = None


class YotoPkceRequest(BaseModel):
    code: str
    codeVerifier: str
    redirectUri: str
    clientId: Optional[str] = None


def extract_request_client_id(request: Request, body_client_id: Optional[str] = None) -> Optional[str]:
    header_val = request.headers.get("x-spotify-client-id")
    if header_val and header_val.strip():
        return header_val.strip()
    if body_client_id and body_client_id.strip():
        return body_client_id.strip()
    return None


def extract_request_yoto_client_id(request: Request, body_client_id: Optional[str] = None) -> Optional[str]:
    header_val = request.headers.get("x-yoto-client-id")
    if header_val and header_val.strip():
        return header_val.strip()
    if body_client_id and body_client_id.strip():
        return body_client_id.strip()
    return None


@app.get("/api/health")
def api_health():
    state = store.load()
    return {
        "status": "ok",
        "stateFile": str(store.path),
        "cachedTracks": len(state.get("tracks", {})),
    }


# -----------------------------------------------------------------------------
# Spotify OAuth 2.0 PKCE & Standard OAuth Endpoints
# -----------------------------------------------------------------------------
@app.post("/api/auth/spotify/pkce")
def spotify_pkce_exchange(payload: SpotifyPkceRequest, request: Request):
    req_client_id = extract_request_client_id(request, payload.clientId)
    client_id, _ = get_spotify_credentials(req_client_id)
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Spotify Client ID is required for PKCE token exchange.",
        )

    state = store.load()
    state.setdefault("settings", dict(DEFAULT_SETTINGS))["spotifyClientId"] = client_id
    store.save(state)

    try:
        resp = requests.post(
            "https://accounts.spotify.com/api/token",
            data={
                "client_id": client_id,
                "grant_type": "authorization_code",
                "code": payload.code,
                "redirect_uri": payload.redirectUri,
                "code_verifier": payload.codeVerifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        if resp.status_code != 200:
            err_text = resp.text
            store.add_activity("System", "Spotify PKCE token exchange failed", "error", err_text)
            raise HTTPException(status_code=400, detail=f"Spotify PKCE token exchange failed: {err_text}")

        token_info = resp.json()
        saved_token = {
            **token_info,
            "client_id": client_id,
            "pkce": True,
            "expires_at": int(time.time()) + int(token_info.get("expires_in", 3600)),
            "scope": token_info.get("scope", SPOTIFY_SCOPES),
        }
        SPOTIFY_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        SPOTIFY_TOKEN_PATH.write_text(json.dumps(saved_token, indent=2), encoding="utf-8")

        profile = get_spotify_user_profile(client_id)
        display_name = profile.get("display_name") if profile else "Spotify User"

        # Programmatically attempt to provision Zotify Login5 credentials.json from the new PKCE token
        acc_tok = token_info.get("access_token")
        if acc_tok:
            try:
                bootstrap_zotify_login5_from_access_token(acc_tok, ZOTIFY_CREDENTIALS_PATH)
                logger.info(f"Auto-provisioned {ZOTIFY_CREDENTIALS_PATH} during Spotify PKCE login.")
            except Exception as boot_exc:
                logger.info(f"Note: Spotify PKCE token could not directly bootstrap Login5 ({boot_exc}); Keymaster flow available in Config.")

        store.add_activity(
            "System",
            f"Connected Spotify account via PKCE: {display_name}",
            "success",
            f"Saved PKCE token cache to {SPOTIFY_TOKEN_PATH}",
        )
        return {"status": "ok", "spotifyUser": profile}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Spotify PKCE error: {exc}")
        store.add_activity("System", f"Spotify PKCE exchange failed: {exc}", "error")
        raise HTTPException(status_code=500, detail=f"Spotify PKCE exchange failed: {exc}")


@app.get("/api/auth/spotify/login")
def spotify_login(request: Request, format: Optional[str] = Query(default=None)):
    req_client_id = extract_request_client_id(request)
    sp_oauth = build_spotify_oauth(client_id_override=req_client_id)
    if sp_oauth is None:
        raise HTTPException(
            status_code=400,
            detail="Paste your Spotify Client ID in System Configuration and use the PKCE Connect Spotify button.",
        )
    auth_url = sp_oauth.get_authorize_url()
    if format == "json":
        return {"url": auth_url}
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/api/auth/spotify/callback")
def spotify_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
):
    if error:
        store.add_activity("System", f"Spotify OAuth failed: {error}", "error")
        return RedirectResponse(url=f"{FRONTEND_URL}/?auth_error={error}", status_code=302)

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code from Spotify.")

    req_client_id = extract_request_client_id(request)
    sp_oauth = build_spotify_oauth(client_id_override=req_client_id)
    if sp_oauth is None:
        raise HTTPException(
            status_code=400,
            detail="SPOTIPY_CLIENT_ID and SPOTIPY_CLIENT_SECRET are not configured.",
        )

    try:
        token_info = sp_oauth.get_access_token(code, as_dict=True, check_cache=False)
        if not token_info or not token_info.get("access_token"):
            raise RuntimeError("Failed to retrieve Spotify access token")

        sp_oauth.cache_handler.save_token_to_cache(token_info)

        profile = get_spotify_user_profile(req_client_id)
        display_name = profile.get("display_name") if profile else "Spotify User"
        store.add_activity(
            "System",
            f"Connected Spotify account: {display_name}",
            "success",
            f"Saved token cache to {SPOTIFY_TOKEN_PATH}",
        )
        return RedirectResponse(url=f"{FRONTEND_URL}/?spotify_connected=1", status_code=302)
    except Exception as exc:
        logger.error(f"Spotify callback error: {exc}")
        store.add_activity("System", f"Spotify OAuth callback failed: {exc}", "error")
        raise HTTPException(status_code=500, detail=f"Spotify OAuth callback failed: {exc}")


# -----------------------------------------------------------------------------
# Yoto OAuth 2.0 PKCE & Standard OAuth Endpoints
# -----------------------------------------------------------------------------
@app.post("/api/auth/yoto/pkce")
def yoto_pkce_exchange(payload: YotoPkceRequest, request: Request):
    req_client_id = extract_request_yoto_client_id(request, payload.clientId)
    client_id, _ = get_yoto_oauth_credentials(req_client_id)
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Yoto Client ID is required for PKCE token exchange.",
        )

    state = store.load()
    state.setdefault("settings", dict(DEFAULT_SETTINGS))["yotoClientId"] = client_id
    store.save(state)

    try:
        resp = requests.post(
            f"{YOTO_AUTH_BASE}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": payload.code,
                "redirect_uri": payload.redirectUri,
                "code_verifier": payload.codeVerifier,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=25,
        )
        if resp.status_code != 200:
            err_text = resp.text
            store.add_activity("System", "Yoto PKCE token exchange failed", "error", err_text)
            raise HTTPException(status_code=400, detail=f"Yoto PKCE token exchange failed: {err_text}")

        token_json = resp.json()
        access_token = token_json.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned from Yoto OAuth endpoint")

        existing = load_yoto_token_data() or {}
        save_yoto_token_data(
            {
                "access_token": access_token,
                "refresh_token": token_json.get("refresh_token") or existing.get("refresh_token"),
                "token_type": token_json.get("token_type", "Bearer"),
                "client_id": client_id,
                "pkce": True,
                "expires_in": token_json.get("expires_in"),
                "scope": token_json.get("scope", YOTO_PKCE_SCOPES),
            }
        )

        # Verify connection by calling GET https://api.yotoplay.com/content/mine
        verified, profile, cards = verify_yoto_connection_via_mine(client_id)
        if not verified:
            store.add_activity(
                "System",
                "Yoto token obtained, but GET /content/mine verification failed",
                "warning",
            )
            raise HTTPException(
                status_code=400,
                detail="Yoto token obtained, but GET https://api.yotoplay.com/content/mine failed verification.",
            )

        store.add_activity(
            "System",
            f"Verified Yoto connection via /content/mine ({len(cards)} MYO cards)",
            "success",
            f"Saved PKCE token cache to {YOTO_TOKEN_PATH}",
        )
        return {
            "status": "ok",
            "yotoUser": profile,
            "yotoCards": cards,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Yoto PKCE error: {exc}")
        store.add_activity("System", f"Yoto PKCE exchange failed: {exc}", "error")
        raise HTTPException(status_code=500, detail=f"Yoto PKCE exchange failed: {exc}")


@app.get("/api/auth/yoto/login")
def yoto_login(
    request: Request,
    flow: Optional[str] = Query(default=None),
    format: Optional[str] = Query(default=None),
):
    req_client_id = extract_request_yoto_client_id(request)
    client_id, _ = get_yoto_oauth_credentials(req_client_id)
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Paste your Yoto Client ID in System Configuration before connecting.",
        )

    params = urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": DEFAULT_YOTO_REDIRECT_URI,
            "scope": YOTO_PKCE_SCOPES,
            "audience": YOTO_API_BASE,
        }
    )
    auth_url = f"{YOTO_AUTH_BASE}/authorize?{params}"
    if format == "json":
        return {"url": auth_url}
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/api/auth/yoto/callback")
def yoto_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
):
    if error:
        store.add_activity("System", f"Yoto OAuth failed: {error}", "error")
        return RedirectResponse(url=f"{FRONTEND_URL}/?auth_error={error}", status_code=302)

    req_client_id = extract_request_yoto_client_id(request)
    client_id, client_secret = get_yoto_oauth_credentials(req_client_id)
    if not client_id or not code:
        raise HTTPException(status_code=400, detail="Missing Yoto Client ID or authorization code.")

    existing = load_yoto_token_data() or {}
    payload: Dict[str, str] = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "redirect_uri": DEFAULT_YOTO_REDIRECT_URI,
    }
    if client_secret:
        payload["client_secret"] = client_secret

    try:
        resp = requests.post(
            f"{YOTO_AUTH_BASE}/oauth/token",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=25,
        )
        resp.raise_for_status()
        token_json = resp.json()

        access_token = token_json.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned from Yoto OAuth endpoint")

        save_yoto_token_data(
            {
                "access_token": access_token,
                "refresh_token": token_json.get("refresh_token") or existing.get("refresh_token"),
                "token_type": token_json.get("token_type", "Bearer"),
                "client_id": client_id,
                "expires_in": token_json.get("expires_in"),
                "scope": token_json.get("scope"),
            }
        )
        verified, profile, cards = verify_yoto_connection_via_mine(client_id)
        display_name = (profile or {}).get("display_name", "Yoto Account")
        store.add_activity(
            "System",
            f"Connected Yoto account: {display_name} ({len(cards)} MYO cards)",
            "success",
            f"Saved access_token & refresh_token to {YOTO_TOKEN_PATH}",
        )
        return RedirectResponse(url=f"{FRONTEND_URL}/?yoto_connected=1", status_code=302)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Yoto callback error: {exc}")
        store.add_activity("System", f"Yoto OAuth callback failed: {exc}", "error")
        raise HTTPException(status_code=500, detail=f"Yoto OAuth callback failed: {exc}")


@app.get("/api/status")
def api_status(request: Request):
    req_sp_client_id = extract_request_client_id(request)
    req_yoto_client_id = extract_request_yoto_client_id(request)
    state = store.load()
    dirty = False
    if req_sp_client_id:
        state.setdefault("settings", dict(DEFAULT_SETTINGS))["spotifyClientId"] = req_sp_client_id
        dirty = True
    if req_yoto_client_id:
        state.setdefault("settings", dict(DEFAULT_SETTINGS))["yotoClientId"] = req_yoto_client_id
        dirty = True
    if dirty:
        store.save(state)

    sp_client_id, _ = get_spotify_credentials(req_sp_client_id)
    yoto_client_id, _ = get_yoto_oauth_credentials(req_yoto_client_id)
    spotify_profile = get_spotify_user_profile(req_sp_client_id)
    sp_client = create_spotify_client(req_sp_client_id)
    yoto_verified, yoto_profile, yoto_cards = verify_yoto_connection_via_mine(req_yoto_client_id)

    return {
        "spotify": bool(spotify_profile or sp_client is not None),
        "yoto": bool(yoto_verified),
        "spotifyConfigured": bool(sp_client_id),
        "yotoConfigured": bool(yoto_client_id or yoto_verified),
        "spotifyClientId": sp_client_id or "",
        "yotoClientId": yoto_client_id or "",
        "spotifyUser": spotify_profile,
        "yotoUser": yoto_profile,
        "yotoCards": yoto_cards,
        "cachedTracksCount": len(state.get("tracks", {})),
        "settings": state.get("settings", DEFAULT_SETTINGS),
    }


@app.get("/api/playlists")
def api_playlists(request: Request):
    req_client_id = extract_request_client_id(request)
    state = store.load()
    sp = create_spotify_client(req_client_id)
    if sp is None:
        return []

    playlists_out: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()

    if SPOTIFY_TOKEN_PATH.exists():
        try:
            user_pls = sp.current_user_playlists(limit=25)
            for item in user_pls.get("items", []):
                if not item or item["id"] in seen_ids:
                    continue
                built = build_playlist_payload(item, sp, state)
                playlists_out.append(built)
                seen_ids.add(built["id"])
        except Exception as exc:
            logger.warning(f"Failed to fetch current_user_playlists: {exc}")

    raw_ids = os.environ.get("SPOTIPY_PLAYLIST_IDS") or os.environ.get("SPOTIFY_PLAYLIST_ID") or ""
    playlist_ids = [pid.strip() for pid in raw_ids.split(",") if pid.strip()]

    for pid in playlist_ids:
        if pid in seen_ids:
            continue
        try:
            pl_data = sp.playlist(pid)
            built = build_playlist_payload(pl_data, sp, state)
            playlists_out.append(built)
            seen_ids.add(built["id"])
        except Exception as exc:
            logger.error(f"Failed to fetch Spotify playlist '{pid}': {exc}")

    return playlists_out


@app.get("/api/yoto/cards/{card_id}")
def api_yoto_card_detail(card_id: str, request: Request):
    req_yoto_client_id = extract_request_yoto_client_id(request)
    state = store.load()
    token_data = load_yoto_token_data() or {}
    cached_list = token_data.get("cards") if isinstance(token_data.get("cards"), list) else []
    cached_raw = next(
        (
            c
            for c in cached_list
            if isinstance(c, dict) and str(c.get("cardId") or c.get("id") or c.get("_id")) == card_id
        ),
        None,
    )

    access_token = get_yoto_token(req_yoto_client_id)
    if access_token:
        try:
            resp = requests.get(
                f"{YOTO_API_BASE}/content/{card_id}",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
                timeout=15,
            )
            if resp.status_code == 200:
                detail_json = resp.json()
                raw_payload = detail_json.get("card") if isinstance(detail_json.get("card"), dict) else detail_json
                merged = {**(cached_raw or {}), **(raw_payload if isinstance(raw_payload, dict) else {}), "cardId": card_id}
                return {"card": parse_single_yoto_card(merged, state)}
        except Exception as exc:
            logger.warning(f"Failed to fetch /content/{card_id}: {exc}")

    if cached_raw:
        return {"card": parse_single_yoto_card(cached_raw, state)}

    return {
        "card": enrich_card_with_local_state(
            {"cardId": card_id, "title": f"MYO Card {card_id}"},
            state,
        )
    }


@app.get("/api/activity")
def api_activity():
    state = store.load()
    return state.get("activity", [])


@app.get("/api/logs")
def api_get_logs():
    creds_path = prepare_zotify_credentials()
    cred_info = inspect_and_normalize_zotify_credentials(creds_path)
    ffmpeg_ok = bool(shutil.which("ffmpeg"))

    zotify_ok = False
    try:
        import importlib.util
        zotify_ok = importlib.util.find_spec("zotify") is not None
    except Exception:
        zotify_ok = False

    raw_tail = ""
    if LOG_FILE_PATH.exists():
        try:
            lines = LOG_FILE_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
            raw_tail = "\n".join(lines[-250:])
        except Exception:
            raw_tail = ""

    return {
        "logs": SYSTEM_LOG_BUFFER,
        "activity": store.load().get("activity", [])[:100],
        "rawLogTail": raw_tail,
        "diagnostics": {
            "credentialsPath": str(creds_path),
            "credentialsExists": cred_info["exists"],
            "credentialsSize": cred_info["size"],
            "credentialsValid": cred_info["valid"],
            "credentialsUsername": cred_info.get("username"),
            "credentialsError": cred_info.get("error"),
            "dataDir": str(DATA_DIR),
            "audioDir": str(AUDIO_DIR),
            "logFilePath": str(LOG_FILE_PATH),
            "ffmpegAvailable": ffmpeg_ok,
            "zotifyAvailable": zotify_ok,
        },
    }


@app.delete("/api/logs")
def api_clear_logs():
    SYSTEM_LOG_BUFFER.clear()
    if LOG_FILE_PATH.exists():
        try:
            LOG_FILE_PATH.write_text("", encoding="utf-8")
        except Exception:
            pass
    logger.info("System logs cleared by user")
    return {"status": "ok"}


class ZotifyExchangeRequest(BaseModel):
    codeOrUrl: str
    codeVerifier: Optional[str] = None


class ZotifyCredentialsSaveRequest(BaseModel):
    credentialsJson: str


@app.get("/api/auth/zotify/status")
def api_zotify_credentials_status():
    creds_path = prepare_zotify_credentials()
    return inspect_and_normalize_zotify_credentials(creds_path)


def _exchange_keymaster_code_and_save(code: str, verifier: str) -> Dict[str, Any]:
    token_resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "authorization_code",
            "client_id": ZOTIFY_KEYMASTER_CLIENT_ID,
            "redirect_uri": ZOTIFY_KEYMASTER_REDIRECT_URI,
            "code": code,
            "code_verifier": verifier,
        },
        timeout=30,
    )
    if not token_resp.ok:
        err_detail = f"Spotify Login5 token exchange failed ({token_resp.status_code}): {token_resp.text}"
        logger.error(err_detail)
        store.add_activity("Zotify Auth", err_detail, "error")
        raise RuntimeError(err_detail)

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise RuntimeError("Spotify token response did not include an access_token.")

    status = bootstrap_zotify_login5_from_access_token(access_token, ZOTIFY_CREDENTIALS_PATH)
    msg = f"Saved Zotify Login5 credentials to {ZOTIFY_CREDENTIALS_PATH} (user: {status.get('username')})"
    logger.info(msg)
    store.add_activity("Zotify Auth", msg, "success")
    return status


def _start_background_zotify_callback_server(code_verifier: str) -> None:
    """
    Starts a non-blocking 120s HTTP listener on 0.0.0.0:4381 with allow_reuse_address=True
    so if port 4381 is reachable (local Docker or port-forwarded), clicking Agree on Spotify
    automatically completes the exchange without needing to copy/paste the redirect URL.
    """
    class ReusableHTTPServer(HTTPServer):
        allow_reuse_address = True

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            code_list = qs.get("code")
            if code_list:
                code_val = code_list[0].strip()
                try:
                    status = _exchange_keymaster_code_and_save(code_val, code_verifier)
                    body = (
                        "<html><body style='background:#121212;color:#fff;font-family:sans-serif;padding:40px;text-align:center;'>"
                        f"<h2 style='color:#1DB954;'>Zotify Login5 Credentials Saved!</h2>"
                        f"<p>Authenticated as <strong>{status.get('username')}</strong> and saved to <code>{status.get('path')}</code>.</p>"
                        "<p>You can close this tab and return to Yotofy.</p></body></html>"
                    ).encode("utf-8")
                    self.send_response(200)
                except Exception as exc:
                    body = f"<html><body><h2>Exchange failed</h2><pre>{exc}</pre></body></html>".encode("utf-8")
                    self.send_response(400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(400)
                self.end_headers()

        def log_message(self, format, *args):
            return

    def serve_once():
        try:
            srv = ReusableHTTPServer(("0.0.0.0", 4381), Handler)
            srv.timeout = 120
            srv.handle_request()
            srv.server_close()
        except Exception:
            pass

    t = threading.Thread(target=serve_once, daemon=True)
    t.start()


@app.get("/api/auth/zotify/url")
def api_zotify_auth_url():
    global _LAST_ZOTIFY_CODE_VERIFIER
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    code_verifier = "".join(secrets.choice(alphabet) for _ in range(128))
    _LAST_ZOTIFY_CODE_VERIFIER = code_verifier

    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")

    try:
        ZOTIFY_PKCE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        ZOTIFY_PKCE_STATE_PATH.write_text(
            json.dumps(
                {
                    "code_verifier": code_verifier,
                    "client_id": ZOTIFY_KEYMASTER_CLIENT_ID,
                    "redirect_uri": ZOTIFY_KEYMASTER_REDIRECT_URI,
                    "created_at": time.time(),
                }
            ),
            encoding="utf-8",
        )
    except Exception:
        pass

    _start_background_zotify_callback_server(code_verifier)

    scope_str = "+".join(ZOTIFY_KEYMASTER_SCOPES.split())
    auth_url = (
        f"https://accounts.spotify.com/authorize?response_type=code"
        f"&client_id={ZOTIFY_KEYMASTER_CLIENT_ID}"
        f"&redirect_uri={ZOTIFY_KEYMASTER_REDIRECT_URI}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
        f"&scope={scope_str}"
    )
    logger.info("Generated Zotify Login5 PKCE authorization URL (and started 4381 listener)")
    return {
        "authUrl": auth_url,
        "codeVerifier": code_verifier,
        "redirectUri": ZOTIFY_KEYMASTER_REDIRECT_URI,
        "clientId": ZOTIFY_KEYMASTER_CLIENT_ID,
    }


@app.post("/api/auth/zotify/from-spotify")
def api_zotify_from_spotify(request: Request):
    """
    Programmatically attempts to generate /app/data/credentials.json from the
    currently connected Spotify OAuth token in /app/data/spotify_token.json.
    """
    req_client_id = extract_request_client_id(request, None)
    # Trigger token refresh if needed via create_spotify_client
    create_spotify_client(req_client_id)

    if not SPOTIFY_TOKEN_PATH.exists():
        raise HTTPException(
            status_code=400,
            detail="No connected Spotify OAuth token found in /app/data/spotify_token.json. Connect Spotify first or use Step 1 & Step 2 below.",
        )

    try:
        tok_data = json.loads(SPOTIFY_TOKEN_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read {SPOTIFY_TOKEN_PATH}: {exc}")

    access_token = tok_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="spotify_token.json does not contain an access_token.")

    try:
        status = bootstrap_zotify_login5_from_access_token(access_token, ZOTIFY_CREDENTIALS_PATH)
        msg = f"Auto-provisioned Zotify Login5 credentials from connected Spotify token (user: {status.get('username')})"
        logger.info(msg)
        store.add_activity("Zotify Auth", msg, "success")
        return {"status": "ok", "method": "spotify_token", **status}
    except Exception as exc:
        err_msg = (
            f"Spotify's Access Point rejected the custom Web API token ({exc}). "
            "Spotify Login5 requires a token issued to Spotify's official Keymaster Client ID (65b708073fc0480ea92a077233ca87bd). "
            "Use Step 1 & Step 2 below to generate /app/data/credentials.json."
        )
        logger.warning(err_msg)
        raise HTTPException(status_code=400, detail=err_msg)


@app.post("/api/auth/zotify/exchange")
def api_zotify_exchange(req: ZotifyExchangeRequest):
    raw_input = (req.codeOrUrl or "").strip()
    if not raw_input:
        raise HTTPException(
            status_code=400,
            detail="Paste the redirect URL (http://127.0.0.1:4381/login?code=...) or authorization code.",
        )

    code = raw_input
    if "code=" in raw_input:
        try:
            parsed = urlparse(raw_input if "://" in raw_input else f"http://localhost/?{raw_input.lstrip('?')}")
            qs = parse_qs(parsed.query)
            if qs.get("code"):
                code = qs["code"][0].strip()
        except Exception:
            pass

    verifier = (req.codeVerifier or "").strip() or _LAST_ZOTIFY_CODE_VERIFIER
    if not verifier and ZOTIFY_PKCE_STATE_PATH.exists():
        try:
            saved_pkce = json.loads(ZOTIFY_PKCE_STATE_PATH.read_text(encoding="utf-8"))
            verifier = saved_pkce.get("code_verifier")
        except Exception:
            pass

    if not verifier:
        raise HTTPException(
            status_code=400,
            detail="Missing PKCE code_verifier. Click '1. Open Spotify Login5 Auth Link' first.",
        )

    token_resp = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "authorization_code",
            "client_id": ZOTIFY_KEYMASTER_CLIENT_ID,
            "redirect_uri": ZOTIFY_KEYMASTER_REDIRECT_URI,
            "code": code,
            "code_verifier": verifier,
        },
        timeout=30,
    )
    if not token_resp.ok:
        err_detail = f"Spotify Login5 token exchange failed ({token_resp.status_code}): {token_resp.text}"
        logger.error(err_detail)
        store.add_activity("Zotify Auth", err_detail, "error")
        raise HTTPException(status_code=400, detail=err_detail)

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Spotify token response did not include an access_token.")

    try:
        status = bootstrap_zotify_login5_from_access_token(access_token, ZOTIFY_CREDENTIALS_PATH)
    except Exception as exc:
        err_msg = f"Failed to create Zotify Login5 session from token: {exc}"
        logger.error(err_msg)
        store.add_activity("Zotify Auth", err_msg, "error")
        raise HTTPException(status_code=500, detail=err_msg)

    msg = f"Saved Zotify Login5 credentials to {ZOTIFY_CREDENTIALS_PATH} (user: {status.get('username')})"
    logger.info(msg)
    store.add_activity("Zotify Auth", msg, "success")
    return {"status": "ok", **status}


@app.post("/api/auth/zotify/credentials")
def api_zotify_save_credentials(req: ZotifyCredentialsSaveRequest):
    raw_json = (req.credentialsJson or "").strip()
    if not raw_json:
        raise HTTPException(status_code=400, detail="Paste the contents of your Zotify credentials.json file.")

    try:
        parsed = json.loads(raw_json)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="credentials.json must be a JSON object.")

    ZOTIFY_CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ZOTIFY_CREDENTIALS_PATH.write_text(json.dumps(parsed, indent=2), encoding="utf-8")
    status = inspect_and_normalize_zotify_credentials(ZOTIFY_CREDENTIALS_PATH)
    if not status.get("valid"):
        raise HTTPException(status_code=400, detail=status.get("error") or "Invalid Zotify credentials.json.")

    msg = f"Saved Zotify Login5 credentials to {ZOTIFY_CREDENTIALS_PATH} (user: {status.get('username')})"
    logger.info(msg)
    store.add_activity("Zotify Auth", msg, "success")
    return {"status": "ok", **status}


@app.post("/api/settings")
def api_save_settings(payload: SettingsUpdateRequest, request: Request):
    req_sp_client_id = extract_request_client_id(request, payload.spotifyClientId)
    req_yoto_client_id = extract_request_yoto_client_id(request, payload.yotoClientId)
    state = store.load()
    dumped = payload.model_dump()
    if req_sp_client_id:
        dumped["spotifyClientId"] = req_sp_client_id
    if req_yoto_client_id:
        dumped["yotoClientId"] = req_yoto_client_id
    state["settings"] = dumped
    store.save(state)
    store.add_activity("System", "Configuration saved to data/state.json", "info")
    return {"status": "ok", "settings": state["settings"]}


@app.post("/api/sync")
def api_sync(req: SyncRequest, request: Request):
    req_client_id = extract_request_client_id(request, req.spotifyClientId)
    sp = create_spotify_client(req_client_id)
    if sp is None:
        store.add_activity(
            "System",
            "Sync aborted: Spotify account not connected",
            "error",
        )
        raise HTTPException(
            status_code=400,
            detail="Spotify account is not connected. Please connect Spotify in Config first.",
        )

    yoto_token = get_yoto_token()
    if not yoto_token or len(yoto_token) <= 8:
        store.add_activity(
            "System",
            "Sync aborted: Yoto account not connected",
            "error",
        )
        raise HTTPException(
            status_code=400,
            detail="Yoto account is not connected. Please connect Yoto in Config first.",
        )

    state = store.load()
    try:
        raw_pl = sp.playlist(req.playlistId)
    except Exception as exc:
        store.add_activity(req.playlistId, f"Failed to load Spotify playlist: {exc}", "error")
        raise HTTPException(status_code=404, detail=f"Failed to fetch Spotify playlist: {exc}")

    playlist_data = build_playlist_payload(raw_pl, sp, state)
    playlist_name = playlist_data["name"]
    tracks = playlist_data["tracks"]

    creds_path = prepare_zotify_credentials()
    creds_exists = creds_path.exists()
    creds_size = creds_path.stat().st_size if creds_exists else 0

    start_details = (
        f"Playlist ID: {req.playlistId} | Tracks: {len(tracks)}\n"
        f"Credentials: {creds_path} (exists={creds_exists}, size={creds_size}B)\n"
        f"Target Card: {'+ Create New' if req.createNew else (req.targetYotoId or 'default')}"
    )
    logger.info(f"Started sync for '{playlist_name}' ({len(tracks)} tracks)", extra={"details": start_details})
    store.add_activity(
        playlist_name,
        f"Started sync for '{playlist_name}' ({len(tracks)} tracks)",
        "info",
        start_details,
    )

    yoto = YotoClient(access_token=yoto_token)
    synced_tracks_for_card: List[Dict[str, Any]] = []
    last_failure_diag: Optional[str] = None

    for track in tracks:
        tid = track["id"]
        cached = store.get_track(tid)
        if cached and cached.get("transcodedSha256"):
            synced_tracks_for_card.append(
                {
                    "spotifyTrackId": tid,
                    "title": cached.get("title") or track["title"],
                    "artist": cached.get("artist") or track["artist"],
                    "transcodedSha256": cached["transcodedSha256"],
                    "duration": cached.get("duration") or track.get("durationSec", 180),
                    "fileSize": cached.get("fileSize") or 0,
                }
            )
            continue

        mp3_path, zotify_diag = download_track_with_zotify(tid, track["title"], creds_path)
        if not mp3_path or not mp3_path.exists():
            last_failure_diag = zotify_diag
            store.add_activity(
                playlist_name,
                f"Zotify download failed for '{track['title']}'",
                "error",
                zotify_diag,
            )
            if (
                "valid=False" in zotify_diag
                or "Credentials file missing or empty" in zotify_diag
                or "ALL LOGIN ATTEMPTS UNSUCCESSFUL" in zotify_diag
            ):
                logger.error("Aborting remaining track downloads due to missing/invalid Zotify Login5 credentials.")
                break
            continue

        store.add_activity(
            playlist_name,
            f"Downloaded '{track['title']}' via Zotify ({mp3_path.stat().st_size // 1024} KB MP3)",
            "download",
            zotify_diag,
        )

        try:
            transcode_info = yoto.upload_and_transcode_track(mp3_path)
            sha256 = transcode_info["transcodedSha256"]
            duration_sec = int(
                (transcode_info.get("transcodedInfo") or {}).get("duration")
                or track.get("durationSec", 180)
            )
            file_size = int(
                (transcode_info.get("transcodedInfo") or {}).get("fileSize")
                or mp3_path.stat().st_size
            )

            store.save_track(
                track_id=tid,
                transcoded_sha256=sha256,
                title=track["title"],
                artist=track["artist"],
                duration_sec=duration_sec,
                file_size=file_size,
                local_file_path=str(mp3_path),
            )
            synced_tracks_for_card.append(
                {
                    "spotifyTrackId": tid,
                    "title": track["title"],
                    "artist": track["artist"],
                    "transcodedSha256": sha256,
                    "duration": duration_sec,
                    "fileSize": file_size,
                }
            )
            store.add_activity(
                playlist_name,
                f"Transcoded '{track['title']}' on Yoto",
                "info",
                f"yoto:#{sha256} (duration={duration_sec}s, size={file_size}B)",
            )
        except Exception as exc:
            err_msg = f"Yoto transcode failed for '{track['title']}': {exc}"
            last_failure_diag = err_msg
            logger.error(err_msg)
            store.add_activity(
                playlist_name,
                err_msg,
                "error",
            )

    if not synced_tracks_for_card:
        fail_summary = (
            f"No tracks could be downloaded and transcoded for '{playlist_name}'. "
            + (f"Last error details:\n{last_failure_diag}" if last_failure_diag else "Check System Logs for full Zotify output.")
        )
        logger.error(f"Sync failed for '{playlist_name}': 0 tracks synced", extra={"details": last_failure_diag})
        raise HTTPException(
            status_code=500,
            detail=fail_summary,
        )


    state = store.load()
    saved_pl = state.get("playlists", {}).get(req.playlistId, {})
    if req.createNew:
        target_card_id = None
    else:
        target_card_id = (
            (req.targetYotoId.strip() if req.targetYotoId else None)
            or (saved_pl.get("syncConfig") or {}).get("targetYotoId")
            or state.get("settings", {}).get("yotoCardId")
            or os.environ.get("YOTO_CARD_ID")
            or None
        )

    effective_title = (req.customTitle or "").strip() or playlist_name

    try:
        card_resp = yoto.upsert_myo_content(
            title=effective_title,
            description=playlist_data.get("description", ""),
            tracks_payload=synced_tracks_for_card,
            card_id=target_card_id,
        )
    except Exception as exc:
        store.add_activity(effective_title, f"POST /content failed: {exc}", "error")
        raise HTTPException(status_code=502, detail=f"Yoto POST /content failed: {exc}")

    resolved_card_id = (
        card_resp.get("cardId")
        or (card_resp.get("card") or {}).get("cardId")
        or card_resp.get("id")
        or target_card_id
    )
    if not resolved_card_id:
        raise HTTPException(
            status_code=502,
            detail="Yoto POST /content succeeded but did not return a cardId.",
        )

    state = store.load()
    sync_config = {
        "enabled": bool(req.autoSync),
        "lastCheck": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "targetYotoId": str(resolved_card_id),
    }
    state.setdefault("playlists", {})[req.playlistId] = {
        "id": req.playlistId,
        "name": effective_title,
        "syncConfig": sync_config,
    }
    store.save(state)

    action_label = "Created new Yoto MYO Playlist" if not target_card_id else "Updated Yoto MYO Playlist"
    store.add_activity(
        effective_title,
        f"{action_label} '{effective_title}' ({len(synced_tracks_for_card)} tracks) -> cardId: {resolved_card_id}",
        "success",
    )

    _, _, refreshed_cards = verify_yoto_connection_via_mine(
        extract_request_yoto_client_id(request, req.yotoClientId)
    )
    updated_playlist = build_playlist_payload(raw_pl, sp, store.load())
    return {
        "status": "synced",
        "cardId": str(resolved_card_id),
        "playlist": updated_playlist,
        "yotoCards": refreshed_cards,
        "activity": store.load().get("activity", []),
    }


@app.api_route("/api/{unmatched_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def unmatched_api_route(unmatched_path: str):
    raise HTTPException(status_code=404, detail=f"API route /api/{unmatched_path} not found")


class SPAStaticFiles(StaticFiles):
    """Mounts the compiled Vite dist/ directory at / with a SPA fallback to dist/index.html."""

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
            if response.status_code == 404:
                return FileResponse(str(Path(self.directory) / "index.html"))
            return response
        except Exception as exc:
            status_code = getattr(exc, "status_code", None)
            if status_code == 404:
                return FileResponse(str(Path(self.directory) / "index.html"))
            raise


# Serve compiled Vite dist/ folder at / (after all /api/* routes) when dist/ exists
if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    app.mount("/", SPAStaticFiles(directory=str(DIST_DIR), html=True), name="spa")


if __name__ == "__main__":
    port = int(os.environ.get("API_PORT") or os.environ.get("PORT") or 8000)
    uvicorn.run(app, host="0.0.0.0", port=port)