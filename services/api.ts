import { Playlist, ActivityLog, AppSettings, YotoCardConfig, ConnectedUserProfile } from '../types';

export interface SystemStatusResponse {
  spotify: boolean;
  yoto: boolean;
  spotifyConfigured?: boolean;
  yotoConfigured?: boolean;
  spotifyClientId?: string;
  spotifyUser?: ConnectedUserProfile | null;
  yotoUser?: ConnectedUserProfile | null;
  cachedTracksCount?: number;
  settings?: AppSettings;
  message?: string;
}

export interface SyncResponse {
  status: 'synced' | 'error';
  playlist?: Playlist;
  yotoCard?: YotoCardConfig;
  activity?: ActivityLog[];
  message?: string;
}

export const SPOTIFY_LOGIN_URL = '/api/auth/spotify/login';
export const YOTO_LOGIN_URL = '/api/auth/yoto/login';

export const SPOTIFY_CLIENT_ID_STORAGE_KEY = 'yotofy_spotify_client_id';
export const SPOTIFY_PKCE_VERIFIER_STORAGE_KEY = 'yotofy_spotify_pkce_verifier';
export const SPOTIFY_PKCE_REDIRECT_STORAGE_KEY = 'yotofy_spotify_pkce_redirect';
export const SPOTIFY_PKCE_RESULT_STORAGE_KEY = 'yotofy_spotify_pkce_result';

export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative';

export const getStoredSpotifyClientId = (): string => {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(SPOTIFY_CLIENT_ID_STORAGE_KEY) || '').trim();
};

export const setStoredSpotifyClientId = (clientId: string): void => {
  if (typeof window === 'undefined') return;
  const trimmed = clientId.trim();
  if (trimmed) {
    localStorage.setItem(SPOTIFY_CLIENT_ID_STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(SPOTIFY_CLIENT_ID_STORAGE_KEY);
  }
};

export const getSpotifyRedirectUri = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000/';
  return `${window.location.origin}/`;
};

function buildApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  const clientId = getStoredSpotifyClientId();
  if (clientId) {
    headers['X-Spotify-Client-Id'] = clientId;
  }
  return headers;
}

// ============================================================================
// OAuth 2.0 PKCE Browser Helpers for Spotify
// ============================================================================
function generateCodeVerifier(length = 64): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  return result;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

export const openSpotifyPkcePopup = async (clientIdInput?: string): Promise<Window | null> => {
  const clientId = (clientIdInput ?? getStoredSpotifyClientId()).trim();
  if (!clientId) {
    throw new Error('Please paste your Spotify Client ID first.');
  }

  setStoredSpotifyClientId(clientId);

  const codeVerifier = generateCodeVerifier(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const redirectUri = getSpotifyRedirectUri();

  localStorage.setItem(SPOTIFY_PKCE_VERIFIER_STORAGE_KEY, codeVerifier);
  localStorage.setItem(SPOTIFY_PKCE_REDIRECT_STORAGE_KEY, redirectUri);
  localStorage.removeItem(SPOTIFY_PKCE_RESULT_STORAGE_KEY);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    scope: SPOTIFY_SCOPES,
    state: 'spotify_pkce',
    show_dialog: 'true',
  });

  const authorizeUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  return window.open(
    authorizeUrl,
    'SpotifyPKCEAuth',
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
  );
};

export const exchangeSpotifyPkceCode = async (
  code: string,
  clientIdOverride?: string
): Promise<{ status: string; spotifyUser?: ConnectedUserProfile | null }> => {
  const clientId = (clientIdOverride || getStoredSpotifyClientId()).trim();
  const codeVerifier = localStorage.getItem(SPOTIFY_PKCE_VERIFIER_STORAGE_KEY) || '';
  const redirectUri =
    localStorage.getItem(SPOTIFY_PKCE_REDIRECT_STORAGE_KEY) || getSpotifyRedirectUri();

  if (!clientId) {
    throw new Error('Missing Spotify Client ID for PKCE token exchange.');
  }
  if (!codeVerifier) {
    throw new Error('Missing PKCE code_verifier in localStorage. Please try connecting again.');
  }

  const response = await fetch('/api/auth/spotify/pkce', {
    method: 'POST',
    headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      code,
      codeVerifier,
      redirectUri,
      clientId,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.detail || data.error || data.message || `Spotify PKCE exchange failed (${response.status})`
    );
  }

  localStorage.removeItem(SPOTIFY_PKCE_VERIFIER_STORAGE_KEY);
  return data;
};

// ============================================================================
// REST API Calls
// ============================================================================
export const getStatus = async (): Promise<SystemStatusResponse> => {
  const response = await fetch('/api/status', {
    method: 'GET',
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch status (${response.status})`);
  }
  return response.json();
};

export const getPlaylists = async (): Promise<Playlist[]> => {
  const response = await fetch('/api/playlists', {
    method: 'GET',
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch playlists (${response.status})`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.playlists) ? data.playlists : [];
};

export const getActivity = async (): Promise<ActivityLog[]> => {
  const response = await fetch('/api/activity', {
    method: 'GET',
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch activity (${response.status})`);
  }
  const data = await response.json();
  const list = Array.isArray(data) ? data : Array.isArray(data?.activity) ? data.activity : [];
  return list.map((item: ActivityLog & { timestamp: string | Date }) => ({
    ...item,
    timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
  }));
};

export const triggerSync = async (payload: {
  playlistId: string;
  autoSync?: boolean;
  targetYotoId?: string;
}): Promise<SyncResponse> => {
  const spotifyClientId = getStoredSpotifyClientId();
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      ...payload,
      ...(spotifyClientId ? { spotifyClientId } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || data.message || `Sync failed (${response.status})`);
  }
  return data;
};

export const saveSettings = async (settings: AppSettings): Promise<AppSettings> => {
  const spotifyClientId = settings.spotifyClientId ?? getStoredSpotifyClientId();
  if (spotifyClientId) {
    setStoredSpotifyClientId(spotifyClientId);
  }
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: buildApiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      ...settings,
      spotifyClientId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save settings (${response.status})`);
  }
  const data = await response.json();
  return data.settings || settings;
};
