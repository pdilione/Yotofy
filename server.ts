import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, 'data');
const STATE_FILE = path.resolve(DATA_DIR, 'state.json');
const SPOTIFY_TOKEN_FILE = path.resolve(DATA_DIR, 'spotify_token.json');
const YOTO_TOKEN_FILE = path.resolve(DATA_DIR, 'yoto_token.json');

const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative';
const DEFAULT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8000/api/auth/spotify/callback';
const DEFAULT_YOTO_REDIRECT_URI = 'http://127.0.0.1:8000/api/auth/yoto/callback';
const YOTO_AUTH_BASE = (process.env.YOTO_AUTH_BASE_URL || 'https://login.yotoplay.com').replace(/\/+$/, '');
const YOTO_API_BASE = 'https://api.yotoplay.com';

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
  };
}

interface ConnectedUserProfile {
  id?: string;
  display_name: string;
  avatar?: string | null;
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

function extractRequestSpotifyClientId(req: express.Request): string {
  const headerVal = req.headers['x-spotify-client-id'];
  if (typeof headerVal === 'string' && headerVal.trim()) {
    return headerVal.trim();
  }
  const bodyVal = req.body?.clientId || req.body?.spotifyClientId;
  if (typeof bodyVal === 'string' && bodyVal.trim()) {
    return bodyVal.trim();
  }
  const queryVal = req.query?.client_id;
  if (typeof queryVal === 'string' && queryVal.trim()) {
    return queryVal.trim();
  }
  return '';
}

function getYotoConfig() {
  const clientId = (process.env.YOTO_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YOTO_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.YOTO_REDIRECT_URI || DEFAULT_YOTO_REDIRECT_URI).trim();
  return { clientId, clientSecret, redirectUri };
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

async function getYotoAccessToken(): Promise<string | null> {
  const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE);
  if (tokenData && tokenData.access_token) {
    const expiresAt = Number(tokenData.expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt && nowSec >= expiresAt - 60 && tokenData.refresh_token) {
      const { clientId, clientSecret } = getYotoConfig();
      if (clientId) {
        try {
          const payload: Record<string, string> = {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: String(tokenData.refresh_token),
          };
          if (clientSecret) payload.client_secret = clientSecret;
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

async function getYotoUserProfile(): Promise<ConnectedUserProfile | null> {
  const tokenData = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE);
  const token = await getYotoAccessToken();
  if (!token) return null;

  if (tokenData?.user?.display_name) {
    return {
      id: tokenData.user.id,
      display_name: tokenData.user.display_name,
      avatar: tokenData.user.avatar || null,
    };
  }

  for (const endpoint of [`${YOTO_AUTH_BASE}/userinfo`, `${YOTO_API_BASE}/user/profile`]) {
    try {
      const resp = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, any>;
        const userObj = (data.user && typeof data.user === 'object' ? data.user : data) as Record<string, any>;
        const displayName =
          userObj.name ||
          userObj.display_name ||
          userObj.nickname ||
          userObj.email ||
          userObj.sub ||
          'Yoto Account';
        const avatar = userObj.picture || userObj.avatar || userObj.icon || null;
        const profile: ConnectedUserProfile = {
          id: userObj.sub || userObj.id || 'yoto-user',
          display_name: String(displayName),
          avatar,
        };
        if (tokenData) {
          saveJsonFile(YOTO_TOKEN_FILE, { ...tokenData, user: profile });
        }
        return profile;
      }
    } catch {
      // continue to next endpoint
    }
  }

  return {
    id: 'yoto-user',
    display_name: 'Yoto Account',
    avatar: null,
  };
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
    const reqClientId = extractRequestSpotifyClientId(req);
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

    // Persist clientId into state.json so subsequent calls work automatically
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
  // Yoto Browser OAuth / Device Code Routes
  // =========================================================================
  app.get('/api/auth/yoto/login', async (req, res) => {
    const flow = String(req.query.flow || 'code');
    const { clientId, redirectUri } = getYotoConfig();
    if (!clientId) {
      return res.status(400).json({
        detail: 'YOTO_CLIENT_ID must be set in .env before starting Yoto OAuth login.',
      });
    }

    if (flow === 'device') {
      try {
        const body = new URLSearchParams({
          client_id: clientId,
          scope: 'openid profile email offline_access',
          audience: YOTO_API_BASE,
        });
        const deviceResp = await fetch(`${YOTO_AUTH_BASE}/oauth/device/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (deviceResp.ok) {
          const deviceData = (await deviceResp.json()) as Record<string, any>;
          saveJsonFile(YOTO_TOKEN_FILE, {
            device_code: deviceData.device_code,
            user_code: deviceData.user_code,
            verification_uri: deviceData.verification_uri,
            verification_uri_complete: deviceData.verification_uri_complete,
            interval: deviceData.interval || 5,
            created_at: Math.floor(Date.now() / 1000),
          });
          const targetUrl =
            deviceData.verification_uri_complete || deviceData.verification_uri;
          if (targetUrl) {
            return res.redirect(String(targetUrl));
          }
        }
      } catch (err) {
        console.error('Yoto device code initiation failed, falling back to authorization code flow:', err);
      }
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access',
      audience: YOTO_API_BASE,
    });
    return res.redirect(`${YOTO_AUTH_BASE}/authorize?${params.toString()}`);
  });

  app.get('/api/auth/yoto/callback', async (req, res) => {
    const { code, device_code, error } = req.query as {
      code?: string;
      device_code?: string;
      error?: string;
    };

    if (error) {
      addActivity('Yoto Auth', `Yoto OAuth error: ${error}`, 'error');
      return res.redirect(getFrontendRedirectUrl(`auth_error=${encodeURIComponent(error)}`));
    }

    const { clientId, clientSecret, redirectUri } = getYotoConfig();
    if (!clientId) {
      return res.status(400).json({ detail: 'YOTO_CLIENT_ID is not configured in .env.' });
    }

    const existing = loadJsonFile<Record<string, any>>(YOTO_TOKEN_FILE) || {};
    const effectiveDeviceCode = device_code || existing.device_code;

    let payload: Record<string, string>;
    if (code) {
      payload = {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
      };
      if (clientSecret) payload.client_secret = clientSecret;
    } else if (effectiveDeviceCode) {
      payload = {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: String(effectiveDeviceCode),
        client_id: clientId,
      };
    } else {
      return res.status(400).json({
        detail: 'Missing authorization code or device_code for Yoto callback.',
      });
    }

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
        expires_in: Number(tokenData.expires_in || 3600),
        expires_at: Math.floor(Date.now() / 1000) + Number(tokenData.expires_in || 3600),
      };
      saveJsonFile(YOTO_TOKEN_FILE, storedPayload);

      const profile = await getYotoUserProfile();
      const displayName = profile?.display_name || 'Yoto Account';
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
    const reqClientId = extractRequestSpotifyClientId(req);
    const state = loadState();
    if (reqClientId && reqClientId !== state.settings.spotifyClientId) {
      state.settings.spotifyClientId = reqClientId;
      saveState(state);
    }

    const { clientId: spId } = getSpotifyConfig(reqClientId);
    const { clientId: yotoClientId } = getYotoConfig();

    const [spotifyProfile, yotoProfile, yotoToken] = await Promise.all([
      getSpotifyUserProfile(reqClientId),
      getYotoUserProfile(),
      getYotoAccessToken(),
    ]);

    res.json({
      spotify: Boolean(spotifyProfile),
      yoto: Boolean(yotoToken),
      spotifyConfigured: Boolean(spId),
      yotoConfigured: Boolean(yotoClientId || yotoToken),
      spotifyClientId: spId || '',
      spotifyUser: spotifyProfile,
      yotoUser: yotoProfile,
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

  app.get('/api/activity', (_req, res) => {
    const state = loadState();
    res.json(state.activity);
  });

  app.post('/api/settings', (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req);
    const state = loadState();
    state.settings = {
      ...state.settings,
      ...req.body,
      ...(reqClientId ? { spotifyClientId: reqClientId } : {}),
    };
    saveState(state);
    addActivity('System', 'Configuration saved to data/state.json', 'info');
    res.json({ status: 'ok', settings: state.settings });
  });

  app.post('/api/sync', async (req, res) => {
    const reqClientId = extractRequestSpotifyClientId(req);
    const { playlistId, autoSync } = req.body as {
      playlistId?: string;
      autoSync?: boolean;
      targetYotoId?: string;
    };

    if (!playlistId) {
      return res.status(400).json({ detail: 'playlistId is required' });
    }

    const token = await getSpotifyUserAccessToken(reqClientId);
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

    const yotoToken = await getYotoAccessToken();
    if (!yotoToken) {
      addActivity('System', 'Sync aborted: Yoto account not connected', 'error');
      return res.status(400).json({
        detail: 'Yoto account is not connected. Please connect via /api/auth/yoto/login.',
      });
    }

    const state = loadState();
    const playlists = (await fetchRealSpotifyPlaylists(token, state)) as Array<Record<string, any>>;
    const matched = playlists.find((p) => p.id === playlistId);
    if (!matched) {
      return res.status(404).json({ detail: `Playlist ${playlistId} not found.` });
    }

    const cardId = matched.syncConfig?.targetYotoId || `card-${playlistId}`;
    state.playlists[playlistId] = {
      id: playlistId,
      name: matched.name,
      syncConfig: {
        enabled: Boolean(autoSync ?? true),
        lastCheck: new Date().toISOString(),
        targetYotoId: cardId,
      },
    };
    saveState(state);
    addActivity(matched.name, `Synced playlist '${matched.name}' to Yoto Card ${cardId}`, 'success');

    return res.json({
      status: 'synced',
      playlist: {
        ...matched,
        syncConfig: state.playlists[playlistId].syncConfig,
      },
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
