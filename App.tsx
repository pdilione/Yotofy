import React, { useState, useEffect, useCallback } from 'react';
import {
  Playlist,
  ScreenState,
  AppSettings,
  ActivityLog,
  ConnectedUserProfile,
  YotoMyoCard,
} from './types';
import {
  exchangeSpotifyPkceCode,
  exchangeYotoPkceCode,
  getStatus,
  getPlaylists,
  getActivity,
  SPOTIFY_PKCE_RESULT_STORAGE_KEY,
  YOTO_PKCE_RESULT_STORAGE_KEY,
} from './services/api';
import { PlaylistCard } from './components/PlaylistCard';
import { SyncView } from './components/SyncView';
import { YotoCardDetailView } from './components/YotoCardDetailView';
import { SettingsView } from './components/SettingsView';
import { SystemLogsView } from './components/SystemLogsView';
import { ActivityFeed } from './components/ActivityFeed';
import { YotoDisplay } from './components/YotoDisplay';
import {
  Radio,
  Settings,
  RefreshCw,
  LayoutGrid,
  ListMusic,
  Database,
  Hash,
  PlusCircle,
  ArrowRight,
  Terminal,
} from 'lucide-react';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('dashboard');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedYotoCardId, setSelectedYotoCardId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [yotoCards, setYotoCards] = useState<YotoMyoCard[]>([]);

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [dashboardView, setDashboardView] = useState<'spotify' | 'yoto'>('spotify');
  const [loading, setLoading] = useState<boolean>(true);
  const [cachedTracksCount, setCachedTracksCount] = useState<number>(0);
  const [isOAuthPopupCallback, setIsOAuthPopupCallback] = useState<boolean>(false);

  const [settings, setSettings] = useState<AppSettings>({
    audioProvider: 'zotify',
    syncFrequency: 'hourly',
    deploymentMode: 'docker',
    autoConversion: true,
    notifications: true,
    githubUser: '',
    githubRepo: 'yotofy',
    yotoCardId: '',
    spotifyClientId: '',
    yotoClientId: '',
  });

  const [connections, setConnections] = useState<{
    spotify: boolean;
    yoto: boolean;
    spotifyUser: ConnectedUserProfile | null;
    yotoUser: ConnectedUserProfile | null;
  }>({
    spotify: false,
    yoto: false,
    spotifyUser: null,
    yotoUser: null,
  });

  const loadBackendState = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, playlistsData, activityData] = await Promise.all([
        getStatus().catch(() => ({
          spotify: false,
          yoto: false,
          spotifyUser: null,
          yotoUser: null,
          yotoCards: [],
          cachedTracksCount: 0,
          settings: undefined,
        })),
        getPlaylists().catch(() => []),
        getActivity().catch(() => []),
      ]);

      setConnections({
        spotify: Boolean(statusData.spotify),
        yoto: Boolean(statusData.yoto),
        spotifyUser: statusData.spotifyUser || null,
        yotoUser: statusData.yotoUser || null,
      });
      setYotoCards(Array.isArray(statusData.yotoCards) ? statusData.yotoCards : []);
      setCachedTracksCount(statusData.cachedTracksCount || 0);
      if (statusData.settings) {
        setSettings(statusData.settings);
      }
      setPlaylists(playlistsData);
      setLogs(activityData);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle Spotify & Yoto OAuth 2.0 PKCE redirects landing on window.location.origin + '/'
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const stateParam = params.get('state');

    if (code || error) {
      const isYoto = stateParam === 'yoto_pkce';
      const callbackType = isYoto ? 'YOTO_PKCE_CALLBACK' : 'SPOTIFY_PKCE_CALLBACK';
      const storageKey = isYoto
        ? YOTO_PKCE_RESULT_STORAGE_KEY
        : SPOTIFY_PKCE_RESULT_STORAGE_KEY;

      window.history.replaceState({}, document.title, window.location.pathname);

      if (window.opener && window.opener !== window) {
        setIsOAuthPopupCallback(true);
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({ code, error, ts: Date.now() })
          );
          window.opener.postMessage(
            { type: callbackType, code, error },
            window.location.origin
          );
        } catch {
          // ignore cross-window errors
        }
        setTimeout(() => {
          window.close();
        }, 150);
        return;
      }

      if (code) {
        const exchangePromise = isYoto
          ? exchangeYotoPkceCode(code)
          : exchangeSpotifyPkceCode(code);
        exchangePromise
          .then(() => loadBackendState())
          .catch(() => loadBackendState());
        return;
      }
    }

    loadBackendState();
  }, [loadBackendState]);

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;
  const selectedYotoCard =
    yotoCards.find((c) => c.cardId === selectedYotoCardId) || null;
  const syncedPlaylists = playlists.filter((p) => p.syncConfig?.enabled);
  const totalYotoItemsCount = syncedPlaylists.length + yotoCards.length;

  const handlePlaylistSelect = (playlist: Playlist) => {
    setSelectedPlaylistId(playlist.id);
    setSelectedYotoCardId(null);
    setCurrentScreen('detail');
  };

  const handleYotoCardSelect = (card: YotoMyoCard) => {
    setSelectedYotoCardId(card.cardId);
    setSelectedPlaylistId(null);
    setCurrentScreen('yoto_detail');
  };

  const handleOpenSpotifyPlaylistFromCard = (
    playlist: Playlist,
    targetCardId: string
  ) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlist.id
          ? {
              ...p,
              syncConfig: {
                enabled: p.syncConfig?.enabled ?? true,
                lastCheck: p.syncConfig?.lastCheck || 'Just now',
                targetYotoId: targetCardId,
              },
            }
          : p
      )
    );
    setSelectedPlaylistId(playlist.id);
    setSelectedYotoCardId(null);
    setCurrentScreen('detail');
  };

  const handleStartCreateNewYotoPlaylist = () => {
    if (playlists.length > 0) {
      // Clear default yotoCardId so SyncView defaults to '+ Create New Yoto Playlist'
      setSettings((prev) => ({ ...prev, yotoCardId: '' }));
      setSelectedPlaylistId(playlists[0].id);
      setSelectedYotoCardId(null);
      setCurrentScreen('detail');
    } else {
      setDashboardView('spotify');
    }
  };

  const handleBack = () => {
    setSelectedPlaylistId(null);
    setSelectedYotoCardId(null);
    setCurrentScreen('dashboard');
  };


  const handlePlaylistSynced = (
    updatedPlaylist: Playlist,
    updatedActivity?: ActivityLog[],
    updatedYotoCards?: YotoMyoCard[]
  ) => {
    setPlaylists((prev) =>
      prev.map((p) => (p.id === updatedPlaylist.id ? updatedPlaylist : p))
    );
    if (Array.isArray(updatedYotoCards)) {
      setYotoCards(updatedYotoCards);
    }
    if (updatedActivity) {
      setLogs(
        updatedActivity.map((item) => ({
          ...item,
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        }))
      );
    } else {
      getActivity()
        .then(setLogs)
        .catch(() => {});
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setCurrentScreen('dashboard');
    loadBackendState();
  };

  if (isOAuthPopupCallback) {
    return (
      <div className="min-h-screen bg-spotify-black text-white flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-8 text-center max-w-sm space-y-3">
          <div className="w-10 h-10 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center mx-auto">
            <Radio size={20} />
          </div>
          <h2 className="text-lg font-bold">OAuth Authorization Complete</h2>
          <p className="text-xs text-gray-400">
            Completing PKCE token exchange with Yotofy. This window will close automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-spotify-black text-white flex flex-col font-sans selection:bg-yoto-orange selection:text-white">
      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-spotify-black z-50 sticky top-0 backdrop-blur-md bg-opacity-90">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={handleBack}>
          <div className="bg-gradient-to-br from-spotify-green to-teal-500 p-2 rounded-lg">
            <Radio className="text-white" size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Yotofy</h1>
        </div>

        <div className="flex items-center space-x-6 text-sm font-medium text-gray-400">
          <button
            onClick={loadBackendState}
            disabled={loading}
            className="flex items-center space-x-2 bg-white/5 hover:bg-white/10 text-gray-200 px-3 py-1.5 rounded-full border border-white/10 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <div className="w-px h-4 bg-gray-700 hidden md:block"></div>

          <button
            onClick={() => setCurrentScreen('logs')}
            className={`flex items-center space-x-1.5 hover:text-white transition-colors ${
              currentScreen === 'logs' ? 'text-spotify-green font-semibold' : ''
            }`}
          >
            <Terminal size={16} />
            <span>Logs</span>
          </button>

          <button
            onClick={() => setCurrentScreen('settings')}
            className={`flex items-center space-x-1 hover:text-white transition-colors ${
              currentScreen === 'settings' ? 'text-white' : ''
            }`}
          >
            <Settings size={16} />
            <span>Config</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {currentScreen === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in-up">
            {/* Left Column: Main Dashboard */}
            <div className="lg:col-span-2 space-y-8">
              {/* Status Widget */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-spotify-green/20 to-yoto-orange/20 p-8 border border-white/5">
                <div className="relative z-10">
                  <h2 className="text-3xl font-extrabold mb-2">
                    {connections.spotify && connections.yoto
                      ? 'System Active.'
                      : 'Disconnected'}
                  </h2>
                  <p className="text-gray-300 text-sm md:text-base mb-4 max-w-xl">
                    {connections.spotify && connections.yoto ? (
                      <>
                        Monitoring <strong>{syncedPlaylists.length} playlists</strong> via
                        Spotipy and connected to <strong>{yotoCards.length} Yoto MYO cards</strong>.
                        Click any Spotify playlist below to sync to an existing card or{' '}
                        <strong className="text-yoto-orange">+ Create New Yoto Playlist</strong>.
                      </>
                    ) : (
                      <>
                        Open <strong>Config</strong> to paste your Spotify and Yoto Client IDs
                        and connect via OAuth 2.0 PKCE.
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border ${
                        connections.spotify
                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                          : 'bg-red-500/10 border-red-500/30 text-red-400'
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          connections.spotify ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <span>
                        Spotify:{' '}
                        {connections.spotify
                          ? connections.spotifyUser?.display_name || 'Connected'
                          : 'Disconnected'}
                      </span>
                    </div>
                    <div
                      className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border ${
                        connections.yoto
                          ? 'bg-yoto-orange/10 border-yoto-orange/30 text-yoto-orange'
                          : 'bg-red-500/10 border-red-500/30 text-red-400'
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          connections.yoto ? 'bg-yoto-orange' : 'bg-red-500'
                        }`}
                      />
                      <span>
                        Yoto:{' '}
                        {connections.yoto
                          ? connections.yotoUser?.display_name || 'Connected'
                          : 'Disconnected'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-full border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                      <Database size={12} />
                      <span>{cachedTracksCount} Cached in data/state.json</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Toggle View */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex space-x-3">
                  <button
                    onClick={() => setDashboardView('spotify')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                      dashboardView === 'spotify'
                        ? 'bg-white text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <ListMusic size={16} />
                    <span>Spotify Sources ({playlists.length})</span>
                  </button>
                  <button
                    onClick={() => setDashboardView('yoto')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                      dashboardView === 'yoto'
                        ? 'bg-white text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <LayoutGrid size={16} />
                    <span>My Yoto Cards ({totalYotoItemsCount})</span>
                  </button>
                </div>

                {playlists.length > 0 && (
                  <button
                    onClick={handleStartCreateNewYotoPlaylist}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-full text-xs font-bold bg-yoto-orange hover:bg-orange-600 text-white shadow-lg shadow-orange-900/30 transition-all"
                  >
                    <PlusCircle size={15} />
                    <span>+ Create New Yoto Playlist</span>
                  </button>
                )}
              </div>

              {/* Grid Content */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {dashboardView === 'spotify' ? (
                  playlists.length > 0 ? (
                    playlists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onClick={handlePlaylistSelect}
                      />
                    ))
                  ) : (
                    <div className="col-span-full py-12 px-6 text-center bg-gray-900/50 rounded-2xl border border-white/5 text-gray-400">
                      <p className="font-semibold text-white mb-1">
                        No playlists synced yet
                      </p>
                      <p className="text-xs text-gray-500">
                        {connections.spotify
                          ? 'No playlists found in your connected Spotify account.'
                          : 'Disconnected — connect your Spotify account in Config.'}
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    {/* + Create New Yoto Playlist Card */}
                    <div
                      onClick={handleStartCreateNewYotoPlaylist}
                      className="cursor-pointer group bg-yoto-orange/10 hover:bg-yoto-orange/20 rounded-2xl p-4 border-2 border-dashed border-yoto-orange/50 hover:border-yoto-orange transition-all hover:-translate-y-1 shadow-lg flex flex-col justify-between"
                    >
                      <div className="aspect-square mb-4 rounded-xl bg-black/40 flex flex-col items-center justify-center p-4 text-center">
                        <PlusCircle size={40} className="text-yoto-orange mb-2 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-bold text-white">
                          + Create New Yoto Playlist
                        </span>
                        <span className="text-[11px] text-gray-400 mt-1">
                          Sync a Spotify playlist into a brand-new MYO card
                        </span>
                      </div>
                      <div>
                        <h3 className="text-center font-bold text-yoto-orange text-sm truncate">
                          + Create New Yoto Playlist
                        </h3>
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                          <span className="text-[10px] bg-yoto-orange/20 text-yoto-orange px-2 py-0.5 rounded-full font-mono">
                            POST /content (new cardId)
                          </span>
                        </div>
                      </div>
                    </div>

                    {syncedPlaylists.map((playlist) => {
                      const cachedInPl = playlist.tracks.filter(
                        (t) => t.inLocalCache && t.transcodedSha256
                      ).length;
                      return (
                        <div
                          key={playlist.id}
                          onClick={() => handlePlaylistSelect(playlist)}
                          className="cursor-pointer group"
                        >
                          <div className="bg-gray-800 rounded-2xl p-4 border border-white/5 hover:border-yoto-orange/50 transition-all hover:-translate-y-1 shadow-lg">
                            <div className="aspect-square mb-4">
                              <YotoDisplay
                                iconGrid={
                                  playlist.generatedIcon || new Array(256).fill('#000000')
                                }
                                themeColor={playlist.themeColor || '#FF6D00'}
                                isSyncing={false}
                              />
                            </div>
                            <h3 className="text-center font-bold text-white text-sm truncate">
                              {playlist.name}
                            </h3>
                            <div className="flex items-center justify-center gap-1.5 mt-2">
                              <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                MYO Synced
                              </span>
                              <span className="text-[10px] bg-white/10 text-gray-300 px-2 py-0.5 rounded-full font-mono flex items-center gap-0.5">
                                <Hash size={9} />
                                {cachedInPl}/{playlist.tracks.length}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {yotoCards.map((card) => (
                      <div
                        key={card.cardId}
                        onClick={() => handleYotoCardSelect(card)}
                        className="cursor-pointer group bg-gray-800 rounded-2xl p-4 border border-white/5 hover:border-yoto-orange/60 transition-all hover:-translate-y-1 shadow-lg flex flex-col justify-between"
                      >
                        <div className="aspect-square mb-4 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center relative">
                          {card.coverImageUrl && card.coverImageUrl.trim() ? (
                            <img
                              src={card.coverImageUrl}
                              alt={card.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <YotoDisplay
                              iconGrid={new Array(256).fill('#000000')}
                              themeColor="#FF6D00"
                              isSyncing={false}
                            />
                          )}
                        </div>
                        <div>
                          <h3 className="text-center font-bold text-white text-sm truncate group-hover:text-yoto-orange transition-colors">
                            {card.title}
                          </h3>
                          <div className="flex items-center justify-center gap-1.5 mt-1.5 text-xs text-gray-400 font-mono tabular-nums">
                            <span className="text-yoto-orange">{card.cardId}</span>
                            {card.trackCount ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{card.trackCount} tracks</span>
                              </>
                            ) : null}
                          </div>
                          {card.linkedSpotifyPlaylistName && (
                            <p className="text-[11px] text-emerald-400 text-center truncate mt-1">
                              Linked: {card.linkedSpotifyPlaylistName}
                            </p>
                          )}
                          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-center gap-1 text-xs font-semibold text-gray-300 group-hover:text-yoto-orange transition-colors">
                            <span>View Details &amp; Sync</span>
                            <ArrowRight size={13} />
                          </div>
                        </div>
                      </div>
                    ))}

                  </>
                )}
              </div>
            </div>

            {/* Right Column: Sidebar */}
            <div className="space-y-6">
              {/* Services Connection Status */}
              <div className="bg-gray-900 rounded-2xl p-6 border border-white/10 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                    Services
                  </h3>
                  <button
                    onClick={() => setCurrentScreen('settings')}
                    className="text-xs text-spotify-green hover:underline"
                  >
                    Manage OAuth
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {connections.spotifyUser?.avatar && (
                        <img
                          src={connections.spotifyUser.avatar}
                          alt={connections.spotifyUser.display_name}
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium text-sm block truncate">
                          {connections.spotifyUser?.display_name || 'Spotify (Spotipy)'}
                        </span>
                        <span className="text-[11px] text-gray-500 block truncate">
                          OAuth 2.0 PKCE
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        connections.spotify
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-red-500/10 text-gray-400'
                      }`}
                    >
                      {connections.spotify ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {connections.yotoUser?.avatar && (
                        <img
                          src={connections.yotoUser.avatar}
                          alt={connections.yotoUser.display_name}
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium text-sm block truncate">
                          {connections.yotoUser?.display_name || 'Yoto Developer API'}
                        </span>
                        <span className="text-[11px] text-gray-500 block truncate">
                          OAuth 2.0 PKCE (/content/mine)
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        connections.yoto
                          ? 'bg-yoto-orange/15 text-yoto-orange'
                          : 'bg-red-500/10 text-gray-400'
                      }`}
                    >
                      {connections.yoto ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Activity Feed */}
              <div className="h-[500px]">
                <ActivityFeed
                  logs={logs}
                  onLogsLoaded={setLogs}
                  onOpenLogs={() => setCurrentScreen('logs')}
                />
              </div>
            </div>
          </div>
        )}

        {currentScreen === 'detail' && selectedPlaylist && (
          <SyncView
            playlist={selectedPlaylist}
            onBack={handleBack}
            onPlaylistSynced={handlePlaylistSynced}
            connected={connections.yoto && connections.spotify}
            settings={settings}
            yotoCards={yotoCards}
            onOpenLogs={() => setCurrentScreen('logs')}
          />
        )}

        {currentScreen === 'yoto_detail' && selectedYotoCard && (
          <YotoCardDetailView
            card={selectedYotoCard}
            playlists={playlists}
            connected={connections.yoto && connections.spotify}
            settings={settings}
            onBack={handleBack}
            onOpenSpotifyPlaylist={handleOpenSpotifyPlaylistFromCard}
            onCardSynced={handlePlaylistSynced}
            onOpenLogs={() => setCurrentScreen('logs')}
          />
        )}

        {currentScreen === 'settings' && (
          <SettingsView
            settings={settings}
            onSave={handleSaveSettings}
            onBack={handleBack}
            onSpotifyConnected={loadBackendState}
          />
        )}

        {currentScreen === 'logs' && <SystemLogsView onBack={handleBack} />}

      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 mt-8 bg-black/20">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-xs">
          <p className="mb-2">Yotofy Personal Automation Tool.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;