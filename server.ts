import express from 'express';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, 'data');
const AUDIO_DIR = path.resolve(DATA_DIR, 'audio');
const STATE_FILE = path.resolve(DATA_DIR, 'state.json');
const SPOTIFY_TOKEN_FILE = path.resolve(DATA_DIR, 'spotify_token.json');
const YOTO_TOKEN_FILE = path.resolve(DATA_DIR, 'yoto_token.json');
const CREDENTIALS_FILE = path.resolve(DATA_DIR, 'credentials.json');
const LOG_FILE = path.resolve(DATA_DIR, 'yotofy.log');

const SPOTIFY_SCOPES =
  'streaming playlist-read-private playlist-read-collaborative user-follow-read user-read-playback-position user-top-read user-read-recently-played user-library-read user-read-email user-read-private';
const DEFAULT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8000/api/auth/spotify/callback';
const DEFAULT_YOTO_REDIRECT_URI = 'http://127.0.0.1:8000/api/auth/yoto/callback';
const YOTO_AUTH_BASE = (process.env.YOTO_AUTH_BASE_URL || 'https://login.yotoplay.com').replace(/\/+$/, '');
const YOTO_API_BASE = 'https://api.yotoplay.com';
const YOTO_PKCE_SCOPES = 'user:content:manage family:library:manage';

// Load .env if present
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

interface PersistedState {
  tracks: Record<string, {
    spotifyTrackId: string;
    transcodedSha256: string;
    title?: string;
    artist?: string;
    duration?: number;
    fileSize?: number;
    localFilePath?: string;
    syncedAt?: string;
  }>;
  playlists: Record<string, {
    id: string;
    name: string;
    syncConfig?: {
      enabled: boolean;
      lastCheck: string;
      targetYotoId: string;
    };
    generatedIcon?: string[];
    themeColor?: string;
  }>;
  activity: Array<{
    id: string;
    timestamp: string;
    playlistName: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'download';
    details?: string;
  }>;
  settings: {
    audioProvider: string;
    syncFrequency: string;
    deploymentMode: string;
    autoConversion: boolean;
    notifications: boolean;
    githubUser: string;
    githubRepo: string;
    yotoCardId?: string;
    spotifyClientId?: string;
    yotoClientId?: string;
  };
}

interface ConnectedUserProfile {
  id?: string;
  display_name: string;
  avatar?: string | null;
  cardCount?: number;
}

interface YotoCardTrackItem {
  key: string;
  title: string;
  trackUrl?: string;
  transcodedSha256?: string;
  duration?: number;
  fileSize?: number;
  format?: string;
  channels?: string;
  artist?: string;
  spotifyTrackId?: string;
}

interface YotoCardChapterItem {
  key: string;
  title: string;
  duration?: number;
  fileSize?: number;
  tracks: YotoCardTrackItem[];
}

interface YotoMyoCard {
  cardId: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  trackCount?: number;
  chapterCount?: number;
  totalDuration?: number;
  playbackType?: string;
  updatedAt?: string;
  createdAt?: string;
  chapters?: YotoCardChapterItem[];
  tracks?: YotoCardTrackItem[];
  linkedSpotifyPlaylistId?: string;
  linkedSpotifyPlaylistName?: string;
}


const DEFAULT_SETTINGS = {
  audioProvider: 'zotify',
  syncFrequency: 'hourly',
  deploymentMode: 'docker',
  autoConversion: true,
  notifications: true,
  githubUser: '',
  githubRepo: 'yotofy',
  yotoCardId: process.env.YOTO_CARD_ID || '',
  spotifyClientId: process.env.SPOTIPY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID || '',
  yotoClientId: process.env.YOTO_CLIENT_ID || '',
};

function loadState(): PersistedState {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    const initial: PersistedState = {
      tracks: {},
      playlists: {},
      activity: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return {
      tracks: parsed.tracks || {},
      playlists: parsed.playlists || {},
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    };
  } catch {
    return {
      tracks: {},
      playlists: {},
      activity: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }
}

function saveState(state: PersistedState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

interface SystemLogItem {
  id: string;
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  details?: string;
}

let systemLogsBuffer: SystemLogItem[] = [];

function checkBinaryAvailable(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ZOTIFY_KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
const ZOTIFY_KEYMASTER_REDIRECT_URI = 'http://127.0.0.1:4381/login';
const ZOTIFY_KEYMASTER_SCOPES =
  'streaming playlist-read-private playlist-read-collaborative user-follow-read user-read-playback-position user-top-read user-read-recently-played user-library-read user-read-email user-read-private';
let lastZotifyCodeVerifier = '';

function inspectZotifyCredentials() {
  const exists = fs.existsSync(CREDENTIALS_FILE);
  const size = exists ? fs.statSync(CREDENTIALS_FILE).size : 0;
  if (!exists || size === 0) {
    return {
      exists,
      valid: false,
      path: CREDENTIALS_FILE,
      size,
      error: 'Credentials file is missing or empty (0 bytes).',
    };
  }
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8').trim();
    const parsed = JSON.parse(raw) as Record<string, any>;
    if (!parsed || typeof parsed !== 'object') {
      return {
        exists: true,
        valid: false,
        path: CREDENTIALS_FILE,
        size,
        error: 'Credentials file is not a JSON object.',
      };
    }
    let changed = false;
    if (!parsed.credentials && parsed.auth_data) {
      parsed.credentials = parsed.auth_data;
      changed = true;
    }
    const credType = parsed.type || parsed.auth_type;
    if (
      (credType === 4 ||
        credType === '4' ||
        credType === 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS' ||
        !credType) &&
      parsed.credentials
    ) {
      if (parsed.type !== 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS') {
        parsed.type = 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS';
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    const username = String(parsed.username || '').trim();
    const credsB64 = String(parsed.credentials || '').trim();
    const finalType = String(parsed.type || '').trim();
    if (finalType === 'OAUTH_PKCE_TOKEN' && parsed.access_token) {
      return {
        exists: true,
        valid: true,
        username: username || 'OAuth PKCE Token',
        type: finalType,
        path: CREDENTIALS_FILE,
        size: fs.statSync(CREDENTIALS_FILE).size,
      };
    }
    if (!username || !credsB64 || finalType !== 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS') {
      return {
        exists: true,
        valid: false,
        path: CREDENTIALS_FILE,
        size,
        error:
          "Invalid Zotify credentials format: expected keys 'username', 'credentials', and 'type': 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS'.",
      };
    }
    return {
      exists: true,
      valid: true,
      username,
      type: finalType,
      path: CREDENTIALS_FILE,
      size: fs.statSync(CREDENTIALS_FILE).size,
    };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      path: CREDENTIALS_FILE,
      size,
      error: `Failed to parse credentials.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function logSystemEvent(
  level: 'INFO' | 'WARNING' | 'ERROR',
  loggerName: string,
  message: string,
  details?: string
) {
  const ts = new Date().toISOString();
  const item: SystemLogItem = {
    id: Math.random().toString(36).substring(2, 12),
    timestamp: ts,
    level,
    logger: loggerName,
    message,
    ...(details ? { details } : {}),
  };
  systemLogsBuffer = [item, ...systemLogsBuffer.slice(0, 299)];
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = `${ts} [${level}] ${loggerName}: ${message}${
      details ? `\n${details}\n${'-'.repeat(60)}` : ''
    }\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // ignore file write errors
  }
}

function addActivity(
  playlistName: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' | 'download' = 'info',
  details?: string
) {
  const state = loadState();
  const entry = {
    id: Math.random().toString(36).substring(2, 12),
    timestamp: new Date().toISOString(),
    playlistName,
    message,
    type,
    ...(details ? { details } : {}),
  };
  state.activity = [entry, ...state.activity.slice(0, 99)];
  saveState(state);

  const levelMap: Record<string, 'INFO' | 'WARNING' | 'ERROR'> = {
    error: 'ERROR',
    warning: 'WARNING',
    info: 'INFO',
    success: 'INFO',
    download: 'INFO',
  };
  logSystemEvent(
    levelMap[type] || 'INFO',
    `yotofy.${playlistName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    `[${playlistName}] ${message}`,
    details
  );
  return entry;
}

function loadJsonFile<T = Record<string, any>>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function saveJsonFile(filePath: string, payload: Record<string, any>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function getSpotifyConfig(reqClientId?: string) {
  const state = loadState();
  const tokenData = loadJsonFile<Record<string, any>>(SPOTIFY_TOKEN_FILE);
  const clientId = (
    reqClientId ||
    state.settings?.spotifyClientId ||
    tokenData?.client_id ||
    process.env.SPOTIPY_CLIENT_ID ||
    process.env.SPOTIFY_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (process.env.SPOTIPY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  const redirectUri = (
    process.env.SPOTIPY_REDIRECT_URI ||
    process.env.SPOTIFY_REDIRECT_URI ||
    DEFAULT_SPOTIFY_REDIRECT_URI
  ).trim();
  return { clientId, clientSecret, redirectUri };
}

function getYotoConfig(reqClientId?: string) {
  const state = loadState();
  const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE);
  const clientId = (
    reqClientId ||
    state.settings?.yotoClientId ||
    tokenData?.client_id ||
    process.env.YOTO_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (process.env.YOTO_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.YOTO_REDIRECT_URI || DEFAULT_YOTO_REDIRECT_URI).trim();
  return { clientId, clientSecret, redirectUri };
}

function extractRequestSpotifyClientId(req: express.Request): string {
  const headerVal = req.headers['x-spotify-client-id'];
  if (typeof headerVal === 'string' && headerVal.trim()) {
    return headerVal.trim();
  }
  const bodyVal = req.body?.spotifyClientId;
  if (typeof bodyVal === 'string' && bodyVal.trim()) {
    return bodyVal.trim();
  }
  return '';
}

function extractRequestYotoClientId(req: express.Request): string {
  const headerVal = req.headers['x-yoto-client-id'];
  if (typeof headerVal === 'string' && headerVal.trim()) {
    return headerVal.trim();
  }
  const bodyVal = req.body?.yotoClientId;
  if (typeof bodyVal === 'string' && bodyVal.trim()) {
    return bodyVal.trim();
  }
  return '';
}

function getFrontendRedirectUrl(querySuffix = ''): string {
  const base = (process.env.FRONTEND_URL || '/').replace(/\/+$/, '') || '/';
  if (!querySuffix) return base;
  return base.includes('?') ? `${base}&${querySuffix}` : `${base}?${querySuffix}`;
}

async function getSpotifyUserAccessToken(reqClientId?: string): Promise<string | null> {
  const tokenData = loadJsonFile<Record<string, any>>(SPOTIFY_TOKEN_FILE);
  if (!tokenData || !tokenData.access_token) return null;

  const expiresAt = Number(tokenData.expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresAt && nowSec >= expiresAt - 60 && tokenData.refresh_token) {
    const { clientId, clientSecret } = getSpotifyConfig(reqClientId || tokenData.client_id);
    if (clientId) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        const bodyParams: Record<string, string> = {
          grant_type: 'refresh_token',
          refresh_token: String(tokenData.refresh_token),
          client_id: clientId,
        };
        if (clientSecret && !tokenData.pkce) {
          const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
          headers.Authorization = `Basic ${basic}`;
        }
        const resp = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers,
          body: new URLSearchParams(bodyParams).toString(),
        });
        if (resp.ok) {
          const refreshed = (await resp.json()) as Record<string, any>;
          const merged: Record<string, any> = {
            ...tokenData,
            ...refreshed,
            client_id: clientId,
            refresh_token: refreshed.refresh_token || tokenData.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
          };
          saveJsonFile(SPOTIFY_TOKEN_FILE, merged);
          return String(merged.access_token);
        }
      } catch (err) {
        console.error('Failed to refresh Spotify OAuth token:', err);
      }
    }
  }

  return String(tokenData.access_token);
}

async function getSpotifyUserProfile(reqClientId?: string): Promise<ConnectedUserProfile | null> {
  const accessToken = await getSpotifyUserAccessToken(reqClientId);
  if (!accessToken) return null;

  try {
    const resp = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const me = (await resp.json()) as Record<string, any>;
    const images = Array.isArray(me.images) ? me.images : [];
    const avatar = images[0]?.url || null;
    return {
      id: me.id,
      display_name: me.display_name || me.id || 'Spotify User',
      avatar,
    };
  } catch {
    return null;
  }
}

async function getYotoAccessToken(reqClientId?: string): Promise<string | null> {
  const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE);
  if (tokenData && tokenData.access_token) {
    const expiresAt = Number(tokenData.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt && nowSec >= expiresAt - 60 && tokenData.refresh_token) {
      const { clientId, clientSecret } = getYotoConfig(reqClientId || tokenData.client_id);
      if (clientId) {
        try {
          const payload: Record<string, string> = {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: String(tokenData.refresh_token),
          };
          if (clientSecret && !tokenData.pkce) {
            payload.client_secret = clientSecret;
          }
          const resp = await fetch(`${YOTO_AUTH_BASE}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(payload).toString(),
          });
          if (resp.ok) {
            const refreshed = (await resp.json()) as Record<string, any>;
            const merged: Record<string, any> = {
              ...tokenData,
              ...refreshed,
              client_id: clientId,
              refresh_token: refreshed.refresh_token || tokenData.refresh_token,
              expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
            };
            saveJsonFile(YOTO_TOKEN_FILE, merged);
            return String(merged.access_token);
          }
        } catch (err) {
          console.error('Failed to refresh Yoto OAuth token:', err);
        }
      }
    }
    return String(tokenData.access_token);
  }

  const envToken = (process.env.YOTO_ACCESS_TOKEN || '').trim();
  return envToken.length > 8 ? envToken : null;
}

function enrichCardWithLocalState(card: YotoMyoCard, state: PersistedState): YotoMyoCard {
  const shaToTrack: Record<string, { spotifyTrackId: string; title?: string; artist?: string; duration?: number; fileSize?: number }> = {};
  for (const t of Object.values(state.tracks || {})) {
    if (t.transcodedSha256) {
      shaToTrack[t.transcodedSha256] = t;
    }
  }

  let linkedPlId: string | undefined;
  let linkedPlName: string | undefined;
  for (const pl of Object.values(state.playlists || {})) {
    if (pl.syncConfig?.targetYotoId === card.cardId) {
      linkedPlId = pl.id;
      linkedPlName = pl.name;
      break;
    }
  }

  const enrichedTracks = (card.tracks || []).map((tr) => {
    const sha = tr.transcodedSha256 || (tr.trackUrl?.startsWith('yoto:#') ? tr.trackUrl.slice(6) : undefined);
    const matched = sha ? shaToTrack[sha] : undefined;
    return {
      ...tr,
      transcodedSha256: sha,
      artist: tr.artist || matched?.artist,
      spotifyTrackId: tr.spotifyTrackId || matched?.spotifyTrackId,
      duration: tr.duration || matched?.duration,
      fileSize: tr.fileSize || matched?.fileSize,
    };
  });

  return {
    ...card,
    tracks: enrichedTracks.length > 0 ? enrichedTracks : card.tracks,
    trackCount: card.trackCount || (enrichedTracks.length > 0 ? enrichedTracks.length : undefined),
    linkedSpotifyPlaylistId: card.linkedSpotifyPlaylistId || linkedPlId,
    linkedSpotifyPlaylistName: card.linkedSpotifyPlaylistName || linkedPlName,
  };
}

function parseSingleYotoCard(item: Record<string, any>, state?: PersistedState): YotoMyoCard {
  const raw = (item.card && typeof item.card === 'object' ? item.card : item) as Record<string, any>;
  const cardId = String(raw.cardId || raw.id || raw._id || '');
  const metadata = (raw.metadata || {}) as Record<string, any>;
  const content = (raw.content || {}) as Record<string, any>;
  const rawChapters = Array.isArray(content.chapters) ? content.chapters : [];

  const chapters: YotoCardChapterItem[] = [];
  const flatTracks: YotoCardTrackItem[] = [];
  let totalDuration = 0;

  for (let cIdx = 0; cIdx < rawChapters.length; cIdx++) {
    const ch = rawChapters[cIdx] as Record<string, any>;
    if (!ch || typeof ch !== 'object') continue;
    const rawTracks = Array.isArray(ch.tracks) ? ch.tracks : [];
    const parsedChTracks: YotoCardTrackItem[] = rawTracks
      .filter((t: any) => t && typeof t === 'object')
      .map((t: Record<string, any>, tIdx: number) => {
        const trackUrl = t.trackUrl ? String(t.trackUrl) : undefined;
        const sha = trackUrl?.startsWith('yoto:#') ? trackUrl.slice(6) : undefined;
        const dur = typeof t.duration === 'number' ? t.duration : undefined;
        if (dur) totalDuration += dur;
        const itemTrack: YotoCardTrackItem = {
          key: String(t.key || String(tIdx + 1).padStart(2, '0')),
          title: String(t.title || ch.title || `Track ${tIdx + 1}`),
          trackUrl,
          transcodedSha256: sha,
          duration: dur,
          fileSize: typeof t.fileSize === 'number' ? t.fileSize : undefined,
          format: t.format ? String(t.format) : undefined,
          channels: t.channels ? String(t.channels) : undefined,
        };
        flatTracks.push(itemTrack);
        return itemTrack;
      });

    chapters.push({
      key: String(ch.key || String(cIdx + 1).padStart(2, '0')),
      title: String(ch.title || `Chapter ${cIdx + 1}`),
      duration: typeof ch.duration === 'number' ? ch.duration : undefined,
      fileSize: typeof ch.fileSize === 'number' ? ch.fileSize : undefined,
      tracks: parsedChTracks,
    });
  }

  const mediaDuration = typeof metadata.media?.duration === 'number' ? metadata.media.duration : undefined;
  const cover =
    metadata.cover?.imageL ||
    metadata.cover?.imageM ||
    metadata.cover?.imageS ||
    raw.coverImageUrl ||
    undefined;

  const baseCard: YotoMyoCard = {
    cardId,
    title: String(raw.title || metadata.title || `MYO Card ${cardId}`),
    description: metadata.description ? String(metadata.description) : raw.description ? String(raw.description) : undefined,
    coverImageUrl: cover,
    trackCount: flatTracks.length || raw.trackCount || chapters.length || undefined,
    chapterCount: chapters.length || raw.chapterCount || undefined,
    totalDuration: totalDuration || mediaDuration || raw.totalDuration || undefined,
    playbackType: content.playbackType ? String(content.playbackType) : raw.playbackType ? String(raw.playbackType) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    chapters: chapters.length > 0 ? chapters : Array.isArray(raw.chapters) ? raw.chapters : undefined,
    tracks: flatTracks.length > 0 ? flatTracks : Array.isArray(raw.tracks) ? raw.tracks : undefined,
  };

  return state ? enrichCardWithLocalState(baseCard, state) : baseCard;
}

function parseYotoMineCards(raw: Record<string, any>, state?: PersistedState): YotoMyoCard[] {
  const rawList = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.cards)
    ? raw.cards
    : Array.isArray(raw.content)
    ? raw.content
    : [];

  return rawList
    .filter((item: any) => item && (item.cardId || item.id || item._id))
    .map((item: Record<string, any>) => parseSingleYotoCard(item, state));
}

async function verifyYotoConnectionViaMine(reqClientId?: string): Promise<{
  verified: boolean;
  profile: ConnectedUserProfile | null;
  cards: YotoMyoCard[];
}> {
  const token = await getYotoAccessToken(reqClientId);
  const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE) || {};
  const state = loadState();
  const cachedCards: YotoMyoCard[] = Array.isArray(tokenData.cards)
    ? tokenData.cards.map((c: Record<string, any>) => parseSingleYotoCard(c, state))
    : [];
  const cachedProfile: ConnectedUserProfile | null =
    tokenData.user || tokenData.profile || (cachedCards.length > 0
      ? {
          id: 'yoto-user',
          display_name: `Yoto Library (${cachedCards.length} MYO Cards)`,
          avatar: null,
          cardCount: cachedCards.length,
        }
      : null);

  if (!token) {
    return {
      verified: cachedCards.length > 0,
      profile: cachedProfile,
      cards: cachedCards,
    };
  }

  try {
    const mineResp = await fetch(`${YOTO_API_BASE}/content/mine`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!mineResp.ok) {
      if (cachedCards.length > 0) {
        return { verified: true, profile: cachedProfile, cards: cachedCards };
      }
      return { verified: false, profile: null, cards: [] };
    }

    const mineJson = (await mineResp.json()) as Record<string, any>;
    const cards = parseYotoMineCards(mineJson, state);

    let displayName = tokenData.user?.display_name || '';
    let avatar: string | null = tokenData.user?.avatar || null;
    let userId = tokenData.user?.id || 'yoto-user';

    if (!displayName || displayName === 'Yoto Account') {
      try {
        const userResp = await fetch(`${YOTO_AUTH_BASE}/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (userResp.ok) {
          const u = (await userResp.json()) as Record<string, any>;
          displayName =
            u.name || u.nickname || u.preferred_username || u.email || u.sub || '';
          avatar = u.picture || u.avatar || null;
          userId = u.sub || u.id || userId;
        }
      } catch {
        // ignore optional userinfo lookup error
      }
    }

    const profile: ConnectedUserProfile = {
      id: userId,
      display_name: displayName || `Yoto Library (${cards.length} MYO Cards)`,
      avatar,
      cardCount: cards.length,
    };

    if (fs.existsSync(YOTO_TOKEN_FILE)) {
      saveJsonFile(YOTO_TOKEN_FILE, {
        ...tokenData,
        user: profile,
        cards,
      });
    }

    return { verified: true, profile, cards };
  } catch (err) {
    console.error('Failed to verify Yoto connection via /content/mine:', err);
    if (cachedCards.length > 0) {
      return { verified: true, profile: cachedProfile, cards: cachedCards };
    }
    return { verified: false, profile: null, cards: [] };
  }
}


function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchRealSpotifyPlaylists(accessToken: string, state: PersistedState) {
  const playlistsOut: unknown[] = [];
  const seenIds = new Set<string>();

  const rawIds =
    process.env.SPOTIPY_PLAYLIST_IDS || process.env.SPOTIFY_PLAYLIST_ID || '';
  const playlistIds = rawIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const mapSpotifyPlaylist = async (plData: Record<string, any>) => {
    const plId = plData.id as string;
    const savedPl: PersistedState['playlists'][string] | undefined = state.playlists[plId];
    let items: any[] = plData.tracks?.items || [];

    if (!Array.isArray(plData.tracks?.items)) {
      const fullResp = await fetch(`https://api.spotify.com/v1/playlists/${plId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (fullResp.ok) {
        const fullPl = (await fullResp.json()) as Record<string, any>;
        items = fullPl.tracks?.items || [];
      }
    }

    const parsedTracks = items
      .map((item) => item?.track)
      .filter((t) => t && t.id)
      .map((track) => {
        const cached = state.tracks[track.id];
        const isCached = Boolean(cached && cached.transcodedSha256);
        const albumImages = track.album?.images || [];
        const plImages = plData.images || [];
        return {
          id: track.id,
          title: track.name || 'Untitled',
          artist: track.artists?.[0]?.name || 'Unknown Artist',
          album: track.album?.name || '',
          duration: formatDurationMs(track.duration_ms || 0),
          imageUrl: albumImages[0]?.url || plImages[0]?.url || '',
          inLocalCache: isCached,
          zotifyStatus: isCached ? 'cached' : 'pending',
          yotoTranscodeStatus: isCached ? 'transcoded' : 'idle',
          transcodedSha256: cached?.transcodedSha256,
          localFilePath: cached?.localFilePath,
          fileSize: cached?.fileSize,
          syncedAt: cached?.syncedAt,
        };
      });

    return {
      id: plId,
      name: plData.name || 'Untitled Playlist',
      description: plData.description || '',
      trackCount: parsedTracks.length || plData.tracks?.total || 0,
      imageUrl: plData.images?.[0]?.url || '',
      tracks: parsedTracks,
      ...(savedPl?.syncConfig ? { syncConfig: savedPl.syncConfig } : {}),
      ...(savedPl?.generatedIcon ? { generatedIcon: savedPl.generatedIcon } : {}),
      ...(savedPl?.themeColor ? { themeColor: savedPl.themeColor } : {}),
    };
  };

  // 1. Fetch current authenticated user's playlists via OAuth token
  try {
    const mePlResp = await fetch('https://api.spotify.com/v1/me/playlists?limit=25', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (mePlResp.ok) {
      const mePls = (await mePlResp.json()) as { items?: Record<string, any>[] };
      for (const item of mePls.items || []) {
        if (!item || !item.id || seenIds.has(item.id)) continue;
        const mapped = await mapSpotifyPlaylist(item);
        playlistsOut.push(mapped);
        seenIds.add(item.id);
      }
    }
  } catch (err) {
    console.error('Failed to fetch current user playlists:', err);
  }

  // 2. Also fetch any explicit playlist IDs from env
  for (const pid of playlistIds) {
    if (seenIds.has(pid)) continue;
    try {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(pid)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (resp.ok) {
        const plData = (await resp.json()) as Record<string, any>;
        const mapped = await mapSpotifyPlaylist(plData);
        playlistsOut.push(mapped);
        seenIds.add(plData.id);
      }
    } catch (err) {
      console.error(`Failed to fetch Spotify playlist ${pid}:`, err);
    }
  }

  return playlistsOut;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const state = loadState();
    res.json({
      status: 'ok',
      stateFile: STATE_FILE,
      cachedTracks: Object.keys(state.tracks).length,
    });
  });

  // =========================================================================
  // Spotify OAuth 2.0 PKCE & Standard OAuth Routes
  // =========================================================================
  app.post('/api/auth/spotify/pkce', async (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req) || String(req.body?.clientId || '').trim();
    const { code, codeVerifier, redirectUri } = req.body as {
      code?: string;
      codeVerifier?: string;
      redirectUri?: string;
      clientId?: string;
    };
    const { clientId } = getSpotifyConfig(reqClientId);

    if (!clientId) {
      return res.status(400).json({
        detail: 'Spotify Client ID is required for PKCE authentication.',
      });
    }
    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({
        detail: 'Missing code, codeVerifier, or redirectUri for Spotify PKCE token exchange.',
      });
    }

    const state = loadState();
    state.settings = { ...state.settings, spotifyClientId: clientId };
    saveState(state);

    try {
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        addActivity('Spotify Auth', 'Spotify PKCE token exchange failed', 'error', errText);
        return res.status(400).json({ detail: `Spotify PKCE token exchange failed: ${errText}` });
      }

      const tokenInfo = (await tokenResp.json()) as Record<string, any>;
      const savedToken = {
        ...tokenInfo,
        client_id: clientId,
        pkce: true,
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenInfo.expires_in || 3600),
        scope: tokenInfo.scope || SPOTIFY_SCOPES,
      };
      saveJsonFile(SPOTIFY_TOKEN_FILE, savedToken);

      const profile = await getSpotifyUserProfile(clientId);
      const displayName = profile?.display_name || 'Spotify User';
      addActivity('Spotify Auth', `Connected Spotify account via PKCE: ${displayName}`, 'success');
      return res.json({ status: 'ok', spotifyUser: profile });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity('Spotify Auth', `Spotify PKCE exchange failed: ${msg}`, 'error');
      return res.status(400).json({ detail: `Spotify PKCE exchange failed: ${msg}` });
    }
  });

  app.get('/api/auth/spotify/login', (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req);
    const { clientId, redirectUri } = getSpotifyConfig(reqClientId);
    if (!clientId) {
      return res.status(400).json({
        detail: 'Paste your Spotify Client ID in System Configuration before connecting.',
      });
    }
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
    });
    return res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  });

  app.get('/api/auth/spotify/callback', async (req, res) => {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error) {
      addActivity('Spotify Auth', `Spotify OAuth error: ${error}`, 'error');
      return res.redirect(getFrontendRedirectUrl(`auth_error=${encodeURIComponent(error)}`));
    }
    if (!code) {
      return res.status(400).json({ detail: 'Missing authorization code from Spotify callback.' });
    }

    const reqClientId = extractRequestSpotifyClientId(req);
    const { clientId, clientSecret, redirectUri } = getSpotifyConfig(reqClientId);
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        detail: 'Use the Connect Spotify PKCE button in Settings (no Client Secret required).',
      });
    }

    try {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        addActivity('Spotify Auth', 'Spotify token exchange failed', 'error', errText);
        return res.status(400).json({ detail: `Spotify token exchange failed: ${errText}` });
      }

      const tokenInfo = (await tokenResp.json()) as Record<string, any>;
      const savedToken = {
        ...tokenInfo,
        client_id: clientId,
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenInfo.expires_in || 3600),
        scope: tokenInfo.scope || SPOTIFY_SCOPES,
      };
      saveJsonFile(SPOTIFY_TOKEN_FILE, savedToken);

      const profile = await getSpotifyUserProfile(clientId);
      const displayName = profile?.display_name || 'Spotify User';
      addActivity('Spotify Auth', `Connected Spotify account: ${displayName}`, 'success');
      return res.redirect(getFrontendRedirectUrl('spotify_connected=1'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity('Spotify Auth', `Spotify OAuth callback failed: ${msg}`, 'error');
      return res.status(400).json({ detail: `Spotify OAuth callback failed: ${msg}` });
    }
  });

  // =========================================================================
  // Yoto OAuth 2.0 PKCE & Standard OAuth Routes
  // =========================================================================
  app.post('/api/auth/yoto/pkce', async (req, res) => {
    const reqClientId = extractRequestYotoClientId(req) || String(req.body?.clientId || '').trim();
    const { code, codeVerifier, redirectUri } = req.body as {
      code?: string;
      codeVerifier?: string;
      redirectUri?: string;
      clientId?: string;
    };
    const { clientId } = getYotoConfig(reqClientId);

    if (!clientId) {
      return res.status(400).json({
        detail: 'Yoto Client ID is required for PKCE authentication.',
      });
    }
    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({
        detail: 'Missing code, codeVerifier, or redirectUri for Yoto PKCE token exchange.',
      });
    }

    const state = loadState();
    state.settings = { ...state.settings, yotoClientId: clientId };
    saveState(state);

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      const tokenResp = await fetch(`${YOTO_AUTH_BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        addActivity('Yoto Auth', 'Yoto PKCE token exchange failed', 'error', errText);
        return res.status(400).json({ detail: `Yoto PKCE token exchange failed: ${errText}` });
      }

      const tokenData = (await tokenResp.json()) as Record<string, any>;
      const existing = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE) || {};
      const storedPayload = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || existing.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        client_id: clientId,
        pkce: true,
        scope: tokenData.scope || YOTO_PKCE_SCOPES,
        expires_in: Number(tokenData.expires_in || 3600),
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenData.expires_in || 3600),
      };
      saveJsonFile(YOTO_TOKEN_FILE, storedPayload);

      // Verify connection by calling GET https://api.yotoplay.com/content/mine
      const verification = await verifyYotoConnectionViaMine(clientId);
      if (!verification.verified) {
        addActivity(
          'Yoto Auth',
          'Yoto token exchanged, but GET /content/mine verification failed',
          'warning'
        );
        return res.status(400).json({
          detail: 'Yoto token obtained, but GET https://api.yotoplay.com/content/mine failed verification.',
        });
      }

      const displayName = verification.profile?.display_name || 'Yoto Account';
      addActivity(
        'Yoto Auth',
        `Verified Yoto connection via /content/mine (${verification.cards.length} MYO cards)`,
        'success',
        displayName
      );

      return res.json({
        status: 'ok',
        yotoUser: verification.profile,
        yotoCards: verification.cards,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity('Yoto Auth', `Yoto PKCE exchange failed: ${msg}`, 'error');
      return res.status(400).json({ detail: `Yoto PKCE exchange failed: ${msg}` });
    }
  });

  app.get('/api/auth/yoto/login', async (req, res) => {
    const reqClientId = extractRequestYotoClientId(req);
    const { clientId, redirectUri } = getYotoConfig(reqClientId);
    if (!clientId) {
      return res.status(400).json({
        detail: 'Paste your Yoto Client ID in System Configuration before connecting.',
      });
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: YOTO_PKCE_SCOPES,
      audience: YOTO_API_BASE,
    });
    return res.redirect(`${YOTO_AUTH_BASE}/authorize?${params.toString()}`);
  });

  app.get('/api/auth/yoto/callback', async (req, res) => {
    const { code, error } = req.query as {
      code?: string;
      error?: string;
    };

    if (error) {
      addActivity('Yoto Auth', `Yoto OAuth error: ${error}`, 'error');
      return res.redirect(getFrontendRedirectUrl(`auth_error=${encodeURIComponent(error)}`));
    }

    const reqClientId = extractRequestYotoClientId(req);
    const { clientId, clientSecret, redirectUri } = getYotoConfig(reqClientId);
    if (!clientId || !code) {
      return res.status(400).json({ detail: 'Missing Yoto Client ID or authorization code.' });
    }

    const existing = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE) || {};
    const payload: Record<string, string> = {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
    };
    if (clientSecret) payload.client_secret = clientSecret;

    try {
      const tokenResp = await fetch(`${YOTO_AUTH_BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(payload).toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        addActivity('Yoto Auth', 'Yoto token exchange failed', 'error', errText);
        return res.status(400).json({ detail: `Yoto token exchange failed: ${errText}` });
      }

      const tokenData = (await tokenResp.json()) as Record<string, any>;
      const storedPayload = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || existing.refresh_token,
        token_type: tokenData.token_type || 'Bearer',
        client_id: clientId,
        expires_in: Number(tokenData.expires_in || 3600),
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenData.expires_in || 3600),
      };
      saveJsonFile(YOTO_TOKEN_FILE, storedPayload);

      const verification = await verifyYotoConnectionViaMine(clientId);
      const displayName = verification.profile?.display_name || 'Yoto Account';
      addActivity('Yoto Auth', `Connected Yoto account: ${displayName}`, 'success');
      return res.redirect(getFrontendRedirectUrl('yoto_connected=1'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity('Yoto Auth', `Yoto OAuth callback failed: ${msg}`, 'error');
      return res.status(400).json({ detail: `Yoto OAuth callback failed: ${msg}` });
    }
  });

  // =========================================================================
  // Core Status, Playlists, Activity & Sync Routes
  // =========================================================================
  app.get('/api/status', async (req, res) => {
    const reqSpClientId = extractRequestSpotifyClientId(req);
    const reqYotoClientId = extractRequestYotoClientId(req);
    const state = loadState();
    let updatedState = false;
    if (reqSpClientId && reqSpClientId !== state.settings.spotifyClientId) {
      state.settings.spotifyClientId = reqSpClientId;
      updatedState = true;
    }
    if (reqYotoClientId && reqYotoClientId !== state.settings.yotoClientId) {
      state.settings.yotoClientId = reqYotoClientId;
      updatedState = true;
    }
    if (updatedState) {
      saveState(state);
    }

    const { clientId: spId } = getSpotifyConfig(reqSpClientId);
    const { clientId: yotoClientId } = getYotoConfig(reqYotoClientId);

    const [spotifyProfile, yotoVerification] = await Promise.all([
      getSpotifyUserProfile(reqSpClientId),
      verifyYotoConnectionViaMine(reqYotoClientId),
    ]);

    res.json({
      spotify: Boolean(spotifyProfile),
      yoto: yotoVerification.verified,
      spotifyConfigured: Boolean(spId),
      yotoConfigured: Boolean(yotoClientId || yotoVerification.verified),
      spotifyClientId: spId || '',
      yotoClientId: yotoClientId || '',
      spotifyUser: spotifyProfile,
      yotoUser: yotoVerification.profile,
      yotoCards: yotoVerification.cards,
      cachedTracksCount: Object.keys(state.tracks).length,
      settings: state.settings,
    });
  });

  app.get('/api/playlists', async (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req);
    const state = loadState();
    const token = await getSpotifyUserAccessToken(reqClientId);
    if (!token) {
      return res.json([]);
    }
    const playlists = await fetchRealSpotifyPlaylists(token, state);
    return res.json(playlists);
  });

  app.get('/api/yoto/cards/:cardId', async (req, res) => {
    const { cardId } = req.params;
    const reqYotoClientId = extractRequestYotoClientId(req);
    const state = loadState();
    const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE) || {};
    const cachedList: Record<string, any>[] = Array.isArray(tokenData.cards) ? tokenData.cards : [];
    const cachedRaw = cachedList.find((c) => String(c.cardId || c.id || c._id) === cardId);

    const token = await getYotoAccessToken(reqYotoClientId);
    if (token) {
      try {
        const detailResp = await fetch(`${YOTO_API_BASE}/content/${encodeURIComponent(cardId)}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        if (detailResp.ok) {
          const detailJson = (await detailResp.json()) as Record<string, any>;
          const parsed = parseSingleYotoCard(
            {
              ...(cachedRaw || {}),
              ...(detailJson.card || detailJson),
              cardId,
            },
            state
          );
          return res.json({ card: parsed });
        }
      } catch (err) {
        console.error(`Failed to fetch /content/${cardId}:`, err);
      }
    }

    if (cachedRaw) {
      const parsed = parseSingleYotoCard(cachedRaw, state);
      return res.json({ card: parsed });
    }

    return res.json({
      card: enrichCardWithLocalState(
        {
          cardId,
          title: `MYO Card ${cardId}`,
        },
        state
      ),
    });
  });

  app.get('/api/activity', (_req, res) => {
    const state = loadState();
    res.json(state.activity);
  });

  app.get('/api/logs', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const state = loadState();

    let rawLogTail = '';
    if (fs.existsSync(LOG_FILE)) {
      try {
        const lines = fs.readFileSync(LOG_FILE, 'utf-8').split(/\r?\n/);
        rawLogTail = lines.slice(-250).join('\n');
      } catch (err) {
        rawLogTail = `Failed to read ${LOG_FILE}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const credInfo = inspectZotifyCredentials();

    res.json({
      logs: systemLogsBuffer.slice(0, limit),
      activity: state.activity.slice(0, 100),
      rawLogTail,
      diagnostics: {
        credentialsPath: CREDENTIALS_FILE,
        credentialsExists: credInfo.exists,
        credentialsSize: credInfo.size,
        credentialsValid: credInfo.valid,
        credentialsUsername: credInfo.username,
        credentialsError: credInfo.error,
        dataDir: DATA_DIR,
        audioDir: AUDIO_DIR,
        logFilePath: LOG_FILE,
        ffmpegAvailable: checkBinaryAvailable('ffmpeg'),
        zotifyAvailable: checkBinaryAvailable('zotify'),
      },
    });
  });

  app.delete('/api/logs', (_req, res) => {
    systemLogsBuffer = [];
    if (fs.existsSync(LOG_FILE)) {
      try {
        fs.writeFileSync(LOG_FILE, '', 'utf-8');
      } catch {
        // ignore
      }
    }
    res.json({ status: 'cleared' });
  });

  app.get('/api/auth/zotify/status', (_req, res) => {
    res.json(inspectZotifyCredentials());
  });

  app.get('/api/auth/zotify/url', (_req, res) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let verifier = '';
    const bytes = crypto.randomBytes(128);
    for (let i = 0; i < 128; i++) {
      verifier += alphabet[bytes[i] % alphabet.length];
    }
    lastZotifyCodeVerifier = verifier;

    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const scopeStr = ZOTIFY_KEYMASTER_SCOPES.split(/\s+/).join('+');
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${ZOTIFY_KEYMASTER_CLIENT_ID}&redirect_uri=${ZOTIFY_KEYMASTER_REDIRECT_URI}&code_challenge=${challenge}&code_challenge_method=S256&scope=${scopeStr}`;

    res.json({
      authUrl,
      codeVerifier: verifier,
      redirectUri: ZOTIFY_KEYMASTER_REDIRECT_URI,
      clientId: ZOTIFY_KEYMASTER_CLIENT_ID,
    });
  });

  app.post('/api/auth/zotify/from-spotify', async (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req);
    const accessToken = await getSpotifyUserAccessToken(reqClientId);
    if (!accessToken) {
      return res.status(400).json({
        detail:
          'No active Spotify OAuth token found in data/spotify_token.json. Connect Spotify above or use Step 1 & Step 2 below.',
      });
    }
    const profile = await getSpotifyUserProfile(reqClientId);
    const username = String(profile?.id || profile?.display_name || 'spotify_user');
    const tokData = loadJsonFile<Record<string, any>>(SPOTIFY_TOKEN_FILE) || {};
    const payload = {
      username,
      client_id: tokData.client_id || ZOTIFY_KEYMASTER_CLIENT_ID,
      access_token: accessToken,
      refresh_token: tokData.refresh_token || '',
      expires_at: tokData.expires_at || Math.floor(Date.now() / 1000) + 3600,
      credentials: Buffer.from(accessToken, 'utf-8').toString('base64'),
      type: 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS',
    };
    saveJsonFile(CREDENTIALS_FILE, payload);
    const status = inspectZotifyCredentials();
    addActivity(
      'Zotify Auth',
      `Auto-provisioned Zotify Login5 credentials from connected Spotify token (user: ${username})`,
      'success'
    );
    return res.json({ status: 'ok', method: 'spotify_token', ...status });
  });

  app.post('/api/auth/zotify/exchange', async (req, res) => {
    const { codeOrUrl, codeVerifier } = req.body as {
      codeOrUrl?: string;
      codeVerifier?: string;
    };
    const raw = (codeOrUrl || '').trim();
    if (!raw) {
      return res.status(400).json({
        detail: 'Paste the redirect URL (http://127.0.0.1:4381/login?code=...) or authorization code.',
      });
    }

    let code = raw;
    if (raw.includes('code=')) {
      try {
        const u = new URL(raw.includes('://') ? raw : `http://localhost/?${raw.replace(/^\?/, '')}`);
        const parsedCode = u.searchParams.get('code');
        if (parsedCode) code = parsedCode.trim();
      } catch {
        // fallback to raw
      }
    }

    const verifier = (codeVerifier || '').trim() || lastZotifyCodeVerifier;
    if (!verifier) {
      return res.status(400).json({
        detail: "Missing PKCE code_verifier. Click '1. Open Spotify Login5 Auth Link' first.",
      });
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ZOTIFY_KEYMASTER_CLIENT_ID,
        redirect_uri: ZOTIFY_KEYMASTER_REDIRECT_URI,
        code,
        code_verifier: verifier,
      });
      const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        addActivity('Zotify Auth', 'Spotify Login5 token exchange failed', 'error', errText);
        return res.status(400).json({
          detail: `Spotify Login5 token exchange failed (${tokenResp.status}): ${errText}`,
        });
      }
      const tokenData = (await tokenResp.json()) as Record<string, any>;
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return res.status(400).json({ detail: 'Spotify token response did not include an access_token.' });
      }

      // Fetch canonical username from /v1/me if available
      let username = 'spotify_user';
      try {
        const meResp = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (meResp.ok) {
          const meJson = (await meResp.json()) as Record<string, any>;
          username = String(meJson.id || meJson.display_name || 'spotify_user');
        }
      } catch {
        // ignore
      }

      const payload = {
        username,
        client_id: ZOTIFY_KEYMASTER_CLIENT_ID,
        access_token: accessToken,
        refresh_token: tokenData.refresh_token || '',
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenData.expires_in || 3600),
        credentials: Buffer.from(accessToken, 'utf-8').toString('base64'),
        type: 'AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS',
      };
      saveJsonFile(CREDENTIALS_FILE, payload);
      const status = inspectZotifyCredentials();
      addActivity(
        'Zotify Auth',
        `Saved Zotify Login5 credentials to ${CREDENTIALS_FILE} (user: ${username})`,
        'success'
      );
      return res.json({ status: 'ok', ...status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ detail: msg });
    }
  });

  app.post('/api/auth/zotify/credentials', (req, res) => {
    const { credentialsJson } = req.body as { credentialsJson?: string };
    const raw = (credentialsJson || '').trim();
    if (!raw) {
      return res.status(400).json({ detail: 'Paste the contents of your Zotify credentials.json file.' });
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return res.status(400).json({ detail: 'credentials.json must be a JSON object.' });
      }
      saveJsonFile(CREDENTIALS_FILE, parsed);
      const status = inspectZotifyCredentials();
      if (!status.valid) {
        return res.status(400).json({ detail: status.error || 'Invalid Zotify credentials.json.' });
      }
      addActivity(
        'Zotify Auth',
        `Saved Zotify Login5 credentials to ${CREDENTIALS_FILE} (user: ${status.username})`,
        'success'
      );
      return res.json({ status: 'ok', ...status });
    } catch (err) {
      return res.status(400).json({
        detail: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });


  app.post('/api/settings', (req, res) => {
    const reqSpClientId = extractRequestSpotifyClientId(req);
    const reqYotoClientId = extractRequestYotoClientId(req);
    const state = loadState();
    state.settings = {
      ...state.settings,
      ...req.body,
      ...(reqSpClientId ? { spotifyClientId: reqSpClientId } : {}),
      ...(reqYotoClientId ? { yotoClientId: reqYotoClientId } : {}),
    };
    saveState(state);
    addActivity('System', 'Configuration saved to data/state.json', 'info');
    res.json({ status: 'ok', settings: state.settings });
  });

  app.post('/api/sync', async (req, res) => {
    const reqSpClientId = extractRequestSpotifyClientId(req);
    const reqYotoClientId = extractRequestYotoClientId(req);
    const { playlistId, autoSync, targetYotoId, createNew, customTitle } = req.body as {
      playlistId?: string;
      autoSync?: boolean;
      targetYotoId?: string;
      createNew?: boolean;
      customTitle?: string;
    };

    if (!playlistId) {
      return res.status(400).json({ detail: 'playlistId is required' });
    }

    const token = await getSpotifyUserAccessToken(reqSpClientId);
    if (!token) {
      addActivity(
        'System',
        'Sync aborted: Spotify account not connected via OAuth',
        'error'
      );
      return res.status(400).json({
        detail: 'Spotify account is not connected. Please connect via PKCE in Config.',
      });
    }

    const yotoToken = await getYotoAccessToken(reqYotoClientId);
    if (!yotoToken) {
      addActivity('System', 'Sync aborted: Yoto account not connected', 'error');
      return res.status(400).json({
        detail: 'Yoto account is not connected. Please connect Yoto via PKCE in Config.',
      });
    }

    const state = loadState();
    const playlists = (await fetchRealSpotifyPlaylists(token, state)) as Array<Record<string, any>>;
    const matched = playlists.find((p) => p.id === playlistId);
    if (!matched) {
      return res.status(404).json({ detail: `Playlist ${playlistId} not found.` });
    }

    const savedPl = state.playlists[playlistId];
    const resolvedTargetCardId = createNew
      ? undefined
      : (targetYotoId && targetYotoId.trim()) ||
        savedPl?.syncConfig?.targetYotoId ||
        (state.settings.yotoCardId && state.settings.yotoCardId.trim()) ||
        undefined;

    const effectiveTitle = (customTitle || '').trim() || matched.name || 'Untitled Playlist';

    // Build chapter tracks from any cached transcodedSha256 tracks in this playlist
    const tracksList = Array.isArray(matched.tracks) ? matched.tracks : [];
    const chapterTracks = tracksList
      .filter((t: any) => t && t.transcodedSha256)
      .map((t: any, idx: number) => ({
        key: String(idx + 1).padStart(2, '0'),
        title: t.title,
        trackUrl: `yoto:#${t.transcodedSha256}`,
        duration: t.durationSec || 180,
        fileSize: t.fileSize || 0,
        format: 'aac',
        type: 'audio',
        channels: 'stereo',
      }));

    // Build POST https://api.yotoplay.com/content payload (omit cardId when creating new)
    const contentPayload: Record<string, any> = {
      title: effectiveTitle,
      metadata: {
        description:
          matched.description || `Synced by Yotofy from Spotify (${tracksList.length} tracks)`,
      },
      content: {
        playbackType: 'linear',
        chapters: [
          {
            key: '01',
            title: effectiveTitle,
            overlayLabel: '1',
            tracks: chapterTracks,
          },
        ],
      },
    };
    if (resolvedTargetCardId) {
      contentPayload.cardId = resolvedTargetCardId;
    }

    let returnedCardId = resolvedTargetCardId || '';
    try {
      const yotoResp = await fetch(`${YOTO_API_BASE}/content`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${yotoToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(contentPayload),
      });

      if (!yotoResp.ok) {
        const errBody = await yotoResp.text();
        addActivity(effectiveTitle, `Yoto POST /content failed (${yotoResp.status})`, 'error', errBody);
        return res.status(yotoResp.status).json({
          detail: `Yoto POST /content failed: ${errBody}`,
        });
      }

      const cardResp = (await yotoResp.json()) as Record<string, any>;
      returnedCardId = String(
        cardResp.cardId || cardResp.card?.cardId || cardResp.id || resolvedTargetCardId || ''
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addActivity(effectiveTitle, `Yoto POST /content error: ${msg}`, 'error');
      return res.status(502).json({ detail: `Yoto POST /content error: ${msg}` });
    }

    if (!returnedCardId) {
      return res.status(502).json({
        detail: 'Yoto POST /content succeeded, but no cardId was returned by Yoto.',
      });
    }

    state.playlists[playlistId] = {
      id: playlistId,
      name: effectiveTitle,
      syncConfig: {
        enabled: Boolean(autoSync ?? true),
        lastCheck: new Date().toISOString(),
        targetYotoId: returnedCardId,
      },
    };
    saveState(state);

    const actionVerb = resolvedTargetCardId ? 'Updated Yoto MYO Playlist' : 'Created new Yoto MYO Playlist';
    addActivity(
      effectiveTitle,
      `${actionVerb} '${effectiveTitle}' -> cardId: ${returnedCardId}`,
      'success'
    );

    const verification = await verifyYotoConnectionViaMine(reqYotoClientId);

    return res.json({
      status: 'synced',
      cardId: returnedCardId,
      playlist: {
        ...matched,
        syncConfig: state.playlists[playlistId].syncConfig,
      },
      yotoCards: verification.cards,
      activity: loadState().activity,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    accept() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
    data: {}
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay extends HTMLElement {
  close() {}
}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Yotofy server running on http://${HOST}:${PORT}`);
  });
}

startServer();
