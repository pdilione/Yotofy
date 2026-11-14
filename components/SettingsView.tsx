import React, { useCallback, useEffect, useState } from 'react';
import { AppSettings, AudioProvider, ConnectedUserProfile, DeploymentMode } from '../types';
import {
  exchangeSpotifyPkceCode,
  getStatus,
  getStoredSpotifyClientId,
  getSpotifyRedirectUri,
  openSpotifyPkcePopup,
  saveSettings,
  setStoredSpotifyClientId,
  SPOTIFY_PKCE_RESULT_STORAGE_KEY,
  YOTO_LOGIN_URL,
} from '../services/api';
import {
  Save,
  Server,
  HardDrive,
  Radio,
  Database,
  CheckCircle,
  AlertCircle,
  Container,
  Github,
  ExternalLink,
  UserCheck,
  Copy,
  Check,
  KeyRound,
} from 'lucide-react';

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
  onSpotifyConnected?: () => void;
}

export const SettingsView: React.FC<Props> = ({
  settings,
  onSave,
  onBack,
  onSpotifyConnected,
}) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [spotifyClientId, setSpotifyClientId] = useState<string>(() =>
    getStoredSpotifyClientId() || settings.spotifyClientId || ''
  );
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [statusInfo, setStatusInfo] = useState<{
    spotify: boolean;
    yoto: boolean;
    spotifyUser: ConnectedUserProfile | null;
    yotoUser: ConnectedUserProfile | null;
    cachedTracksCount: number;
  }>({
    spotify: false,
    yoto: false,
    spotifyUser: null,
    yotoUser: null,
    cachedTracksCount: 0,
  });
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const redirectUri = getSpotifyRedirectUri();

  const refreshStatus = useCallback(async () => {
    try {
      const res = await getStatus();
      setStatusInfo({
        spotify: Boolean(res.spotify),
        yoto: Boolean(res.yoto),
        spotifyUser: res.spotifyUser || null,
        yotoUser: res.yotoUser || null,
        cachedTracksCount: res.cachedTracksCount || 0,
      });
      if (res.settings) {
        setLocalSettings(res.settings);
      }
      const storedId = getStoredSpotifyClientId();
      if (!storedId && (res.spotifyClientId || res.settings?.spotifyClientId)) {
        const backendId = (res.spotifyClientId || res.settings?.spotifyClientId || '').trim();
        if (backendId) {
          setSpotifyClientId(backendId);
          setStoredSpotifyClientId(backendId);
        }
      }
    } catch {
      setStatusInfo({
        spotify: false,
        yoto: false,
        spotifyUser: null,
        yotoUser: null,
        cachedTracksCount: 0,
      });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handlePkceCodeReceived = useCallback(
    async (code?: string | null, error?: string | null) => {
      if (error) {
        setConnectingSpotify(false);
        setErrorMessage(`Spotify authorization error: ${error}`);
        return;
      }
      if (!code) return;

      setConnectingSpotify(true);
      setErrorMessage(null);
      try {
        await exchangeSpotifyPkceCode(code, spotifyClientId);
        await refreshStatus();
        onSpotifyConnected?.();
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Spotify PKCE token exchange failed'
        );
      } finally {
        setConnectingSpotify(false);
      }
    },
    [spotifyClientId, refreshStatus, onSpotifyConnected]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'SPOTIFY_PKCE_CALLBACK') {
        handlePkceCodeReceived(event.data.code, event.data.error);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === SPOTIFY_PKCE_RESULT_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          localStorage.removeItem(SPOTIFY_PKCE_RESULT_STORAGE_KEY);
          handlePkceCodeReceived(parsed.code, parsed.error);
        } catch {
          // ignore malformed storage value
        }
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, [handlePkceCodeReceived]);

  const handleClientIdChange = (value: string) => {
    setSpotifyClientId(value);
    setStoredSpotifyClientId(value);
    setLocalSettings((prev) => ({ ...prev, spotifyClientId: value.trim() }));
  };

  const handleCopyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    } catch {
      // Fallback copy if clipboard API is restricted
      const input = document.createElement('input');
      input.value = redirectUri;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    }
  };

  const handleConnectSpotify = async () => {
    setErrorMessage(null);
    const trimmedId = spotifyClientId.trim();
    if (!trimmedId) {
      setErrorMessage('Please paste your Spotify Client ID above before clicking Connect Spotify.');
      return;
    }

    setConnectingSpotify(true);
    try {
      // Persist the Client ID to backend settings as well
      await saveSettings({ ...localSettings, spotifyClientId: trimmedId }).catch(() => {});
      const popup = await openSpotifyPkcePopup(trimmedId);
      if (!popup) {
        setConnectingSpotify(false);
        setErrorMessage(
          'Popup blocked by browser. Please allow popups for this site and click Connect Spotify again.'
        );
      }
    } catch (err) {
      setConnectingSpotify(false);
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to start Spotify PKCE login'
      );
    }
  };

  const handleConnectYoto = () => {
    window.open(
      YOTO_LOGIN_URL,
      'YotoOAuthPopup',
      'width=520,height=720,menubar=no,toolbar=no,location=yes,status=no'
    );
  };

  const handleProviderChange = (provider: AudioProvider) => {
    setLocalSettings({ ...localSettings, audioProvider: provider });
  };

  const handleDeploymentChange = (mode: DeploymentMode) => {
    setLocalSettings({ ...localSettings, deploymentMode: mode });
  };

  const handlePersistSettings = async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const updated = await saveSettings({
        ...localSettings,
        spotifyClientId: spotifyClientId.trim(),
      });
      onSave(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in max-w-2xl mx-auto pb-10">
      <div className="flex items-center mb-8">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white mr-4 transition-colors font-medium"
        >
          &larr; Back
        </button>
        <h2 className="text-2xl font-bold text-white">System Configuration</h2>
      </div>

      <div className="space-y-8">
        {/* OAuth 2.0 PKCE & Account Connections */}
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center">
              <UserCheck className="mr-2 text-spotify-green" size={20} />
              Connected Accounts (OAuth 2.0 PKCE)
            </h3>
            <span className="text-xs text-gray-400 font-mono">
              Cached Tracks:{' '}
              <strong className="text-emerald-400">{statusInfo.cachedTracksCount}</strong>
            </span>
          </div>
          <p className="text-gray-400 text-xs leading-relaxed">
            Spotify uses browser-based <strong>OAuth 2.0 PKCE</strong> in a popup window — only your{' '}
            <strong>Spotify Client ID</strong> is required (no Client Secret or <code>.env</code>{' '}
            file needed).
          </p>

          {/* Spotify Developer Dashboard Setup: Client ID Input + Exact Redirect URI Copy */}
          <div className="bg-black/40 rounded-xl p-4 border border-white/10 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5 flex items-center gap-1.5">
                <KeyRound size={14} className="text-spotify-green" />
                <span>Spotify Client ID</span>
              </label>
              <input
                type="text"
                value={spotifyClientId}
                onChange={(e) => handleClientIdChange(e.target.value)}
                placeholder="Paste your Spotify Client ID (e.g. 4b8f9c2a...)"
                className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2.5 text-white text-xs font-mono focus:border-spotify-green focus:outline-none"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Saved automatically to <code>localStorage</code> and sent to the backend via{' '}
                <code>X-Spotify-Client-Id</code>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-300 mb-1.5">
                Spotify Redirect URI (Paste into your Spotify Developer Dashboard)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={redirectUri}
                  className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-emerald-400 text-xs font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyRedirectUri}
                  className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {copiedRedirect ? (
                    <>
                      <Check size={14} className="text-spotify-green" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Spotify OAuth PKCE Card */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex flex-col justify-between space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Spotify Account</span>
                <span
                  className={`flex items-center gap-1 text-xs font-bold ${
                    statusInfo.spotify ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {statusInfo.spotify ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                  {statusInfo.spotify ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {statusInfo.spotify && statusInfo.spotifyUser ? (
                <div className="flex items-center space-x-3 p-2.5 rounded-lg bg-white/5 border border-white/5">
                  {statusInfo.spotifyUser.avatar ? (
                    <img
                      src={statusInfo.spotifyUser.avatar}
                      alt={statusInfo.spotifyUser.display_name}
                      className="w-10 h-10 rounded-full object-cover border border-spotify-green/40"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center font-bold text-sm">
                      {statusInfo.spotifyUser.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {statusInfo.spotifyUser.display_name}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      PKCE token cached in data/spotify_token.json
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500 py-2">
                  Disconnected — paste your Spotify Client ID above and click Connect Spotify.
                </div>
              )}

              <button
                type="button"
                onClick={handleConnectSpotify}
                disabled={connectingSpotify}
                className="w-full py-2.5 px-4 rounded-lg bg-spotify-green hover:bg-green-500 text-black font-bold text-xs flex items-center justify-center space-x-2 transition-colors disabled:opacity-60"
              >
                <span>
                  {connectingSpotify
                    ? 'Waiting for Spotify Popup...'
                    : statusInfo.spotify
                    ? 'Reconnect Spotify'
                    : 'Connect Spotify'}
                </span>
                <ExternalLink size={13} />
              </button>
            </div>

            {/* Yoto OAuth Card */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 flex flex-col justify-between space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Yoto Account</span>
                <span
                  className={`flex items-center gap-1 text-xs font-bold ${
                    statusInfo.yoto ? 'text-yoto-orange' : 'text-red-400'
                  }`}
                >
                  {statusInfo.yoto ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                  {statusInfo.yoto ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {statusInfo.yoto && statusInfo.yotoUser ? (
                <div className="flex items-center space-x-3 p-2.5 rounded-lg bg-white/5 border border-white/5">
                  {statusInfo.yotoUser.avatar ? (
                    <img
                      src={statusInfo.yotoUser.avatar}
                      alt={statusInfo.yotoUser.display_name}
                      className="w-10 h-10 rounded-full object-cover border border-yoto-orange/40"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-yoto-orange/20 text-yoto-orange flex items-center justify-center font-bold text-sm">
                      {statusInfo.yotoUser.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {statusInfo.yotoUser.display_name}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      Token cached in data/yoto_token.json
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500 py-2">
                  Disconnected — authorize Yoto Developer API to upload MYO audio and update cards.
                </div>
              )}

              <button
                type="button"
                onClick={handleConnectYoto}
                className="w-full py-2.5 px-4 rounded-lg bg-yoto-orange hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-colors"
              >
                <span>{statusInfo.yoto ? 'Reconnect Yoto' : 'Connect Yoto'}</span>
                <ExternalLink size={13} />
              </button>
            </div>
          </div>

          <div className="bg-black/40 rounded-xl p-4 border border-white/5 text-xs space-y-2">
            <div className="text-gray-300 font-semibold flex items-center gap-1.5">
              <Database size={13} className="text-emerald-400" />
              <span>Optional `.env` Variables (Local / Docker):</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 font-mono text-[11px] text-gray-400">
              <div>
                <span className="text-spotify-green">SPOTIPY_CLIENT_ID</span>=optional_if_set_in_ui
              </div>
              <div>
                <span className="text-yoto-orange">YOTO_CLIENT_ID</span>=your_yoto_client_id
              </div>
              <div>
                <span className="text-yoto-orange">YOTO_ACCESS_TOKEN</span>=optional_direct_yoto_token
              </div>
            </div>
          </div>
        </div>

        {/* Audio Source Strategy */}
        <div className="bg-gray-900 border border-white/5 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center">
            <Server className="mr-2 text-spotify-green" size={20} />
            Audio Source Strategy
          </h3>
          <div className="space-y-3">
            <div
              onClick={() => handleProviderChange('zotify')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                localSettings.audioProvider === 'zotify'
                  ? 'bg-spotify-green/10 border-spotify-green'
                  : 'bg-black/20 border-white/5 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-spotify-green/20 rounded-lg text-spotify-green">
                  <Radio size={18} />
                </div>
                <div>
                  <div className="text-white font-medium">Zotify (librespot-python)</div>
                  <div className="text-xs text-gray-500">
                    Downloads 320kbps MP3s directly from Spotify streams.
                  </div>
                </div>
              </div>
              {localSettings.audioProvider === 'zotify' && (
                <div className="w-3 h-3 bg-spotify-green rounded-full" />
              )}
            </div>

            <div
              onClick={() => handleProviderChange('local_library')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                localSettings.audioProvider === 'local_library'
                  ? 'bg-spotify-green/10 border-spotify-green'
                  : 'bg-black/20 border-white/5 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                  <HardDrive size={18} />
                </div>
                <div>
                  <div className="text-white font-medium">Local `/music` Library</div>
                  <div className="text-xs text-gray-500">
                    Uses pre-existing MP3 files in the mounted `/music` directory.
                  </div>
                </div>
              </div>
              {localSettings.audioProvider === 'local_library' && (
                <div className="w-3 h-3 bg-spotify-green rounded-full" />
              )}
            </div>
          </div>
        </div>

        {/* Deployment Target */}
        <div className="bg-gray-900 border border-white/5 rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center">
            <Container className="mr-2 text-blue-400" size={20} />
            Runtime Mode
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => handleDeploymentChange('docker')}
              className={`p-3 rounded-lg border text-left transition-all ${
                localSettings.deploymentMode === 'docker'
                  ? 'bg-blue-500/20 border-blue-500 text-white'
                  : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
              }`}
            >
              <Container size={18} className="mb-2" />
              <div className="font-bold text-sm">Docker Compose Stack</div>
              <div className="text-[10px] opacity-70">UI (:3000) + FastAPI (:8000)</div>
            </button>

            <button
              onClick={() => handleDeploymentChange('github_actions')}
              className={`p-3 rounded-lg border text-left transition-all ${
                localSettings.deploymentMode === 'github_actions'
                  ? 'bg-blue-500/20 border-blue-500 text-white'
                  : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'
              }`}
            >
              <Github size={18} className="mb-2" />
              <div className="font-bold text-sm">Scheduled Cron</div>
              <div className="text-[10px] opacity-70">Automated CLI Execution</div>
            </button>
          </div>

          <div>
            <label className="block text-[10px] uppercase text-gray-400 font-bold mb-1">
              Default Target Yoto Card ID (Optional)
            </label>
            <input
              type="text"
              value={localSettings.yotoCardId || ''}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, yotoCardId: e.target.value })
              }
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-yoto-orange focus:outline-none"
              placeholder="e.g. 73shQ"
            />
          </div>
        </div>

        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 rounded-xl text-xs">
            {errorMessage}
          </div>
        )}

        <button
          onClick={handlePersistSettings}
          disabled={saving}
          className="w-full bg-white text-black font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
        >
          <Save size={18} />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </div>
  );
};