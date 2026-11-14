import React, { useState } from 'react';
import { MOCK_PLAYLISTS, MOCK_LOGS } from './services/mockData';
import { Playlist, Track, ScreenState, AppSettings, ActivityLog } from './types';
import { PlaylistCard } from './components/PlaylistCard';
import { SyncView } from './components/SyncView';
import { SettingsView } from './components/SettingsView';
import { ActivityFeed } from './components/ActivityFeed';
import { YotoDisplay } from './components/YotoDisplay';
import { Radio, Settings, Play, LayoutGrid, ListMusic, Database, DownloadCloud, Hash } from 'lucide-react';

const makeSimulatedSha256 = (seed: string): string => {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 64; i++) {
    const code = (seed.charCodeAt(i % seed.length) * 19 + i * 29) % 16;
    out += chars[code];
  }
  return out;
};

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('dashboard');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>(MOCK_PLAYLISTS);
  const [logs, setLogs] = useState<ActivityLog[]>(MOCK_LOGS);
  const [dashboardView, setDashboardView] = useState<'spotify' | 'yoto'>('spotify');
  const [activePipelineNotice, setActivePipelineNotice] = useState<string | null>(null);

  // App Level Settings (defaulting to Zotify librespot-python)
  const [settings, setSettings] = useState<AppSettings>({
    audioProvider: 'zotify',
    syncFrequency: 'hourly',
    deploymentMode: 'browser',
    autoConversion: true,
    notifications: true,
    githubUser: 'your-username',
    githubRepo: 'yotofy',
  });

  // Connection State (both connected by default so user can immediately test Zotify + Yoto 4-step sync)
  const [connections, setConnections] = useState({
    spotify: true,
    yoto: true,
  });

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;

  const totalTracksCount = playlists.reduce((acc, p) => acc + p.tracks.length, 0);
  const totalCachedCount = playlists.reduce(
    (acc, p) => acc + p.tracks.filter((t) => t.inLocalCache && t.transcodedSha256).length,
    0
  );
  const totalUncachedCount = totalTracksCount - totalCachedCount;

  const handlePlaylistSelect = (playlist: Playlist) => {
    setSelectedPlaylistId(playlist.id);
    setCurrentScreen('detail');
  };

  const handleBack = () => {
    setSelectedPlaylistId(null);
    setCurrentScreen('dashboard');
  };

  const addLog = (
    playlistName: string,
    message: string,
    type: ActivityLog['type'],
    details?: string
  ) => {
    const newLog: ActivityLog = {
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date(),
      playlistName,
      message,
      type,
      details,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  const handleToggleSync = (
    playlistId: string,
    enabled: boolean,
    updatedTracks?: Track[],
    iconGrid?: string[],
    themeColor?: string
  ) => {
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const tracksToUse = updatedTracks || p.tracks;
        return {
          ...p,
          tracks: tracksToUse,
          trackCount: tracksToUse.length,
          generatedIcon: iconGrid || p.generatedIcon,
          themeColor: themeColor || p.themeColor,
          syncConfig: enabled
            ? {
                enabled: true,
                lastCheck: 'Just now',
                targetYotoId: p.syncConfig?.targetYotoId || `card-${playlistId}`,
              }
            : undefined,
        };
      })
    );
  };

  const toggleConnection = (service: 'spotify' | 'yoto') => {
    setConnections((prev) => {
      const nextState = !prev[service];
      addLog(
        'System',
        `${service === 'spotify' ? 'Spotify (Spotipy/Zotify)' : 'Yoto Developer API'} ${
          nextState ? 'connected' : 'disconnected'
        }`,
        'info'
      );
      return { ...prev, [service]: nextState };
    });
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setCurrentScreen('dashboard');
    addLog('System', 'Configuration updated', 'info');
  };

  // Real-time simulation of a new Spotify track going through Zotify + Yoto 4-step API + SQLite/JSON cache
  const simulateSpotifyUpdate = () => {
    if (!connections.spotify) {
      addLog('System', 'Connect Spotify first!', 'warning');
      return;
    }
    if (!connections.yoto) {
      addLog('System', 'Connect Yoto Developer API first!', 'warning');
      return;
    }

    const syncedPlaylists = playlists.filter((p) => p.syncConfig?.enabled);
    if (syncedPlaylists.length === 0) {
      addLog('System', 'Enable Auto-Sync on at least one playlist first.', 'warning');
      return;
    }

    const target = syncedPlaylists[Math.floor(Math.random() * syncedPlaylists.length)];
    const trackNum = target.tracks.length + 1;
    const newTrackId = `${target.id}-sp-${Date.now().toString(36).slice(-4)}`;
    const newSongTitle = `Spotify Track #${trackNum}`;
    const cardId = target.syncConfig?.targetYotoId || `card-${target.id}`;
    const cachedBefore = target.tracks.filter((t) => t.inLocalCache && t.transcodedSha256).length;

    const pendingTrack: Track = {
      id: newTrackId,
      title: newSongTitle,
      artist: 'Spotify Artist',
      album: target.name,
      duration: '3:18',
      imageUrl: `https://picsum.photos/seed/${newTrackId}/64/64`,
      inLocalCache: false,
      zotifyStatus: 'downloading',
      yotoTranscodeStatus: 'idle',
    };

    // 1. Add uncached track to playlist & log Spotipy detection
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === target.id
          ? { ...p, tracks: [pendingTrack, ...p.tracks], trackCount: p.tracks.length + 1 }
          : p
      )
    );
    setActivePipelineNotice(
      `Spotipy detected "${newSongTitle}" in ${target.name} (${cachedBefore} cached, 1 uncached)`
    );
    addLog(
      target.name,
      `Spotipy: New track "${newSongTitle}" detected (Cache miss in sync_cache.db)`,
      'info',
      `${cachedBefore} existing tracks skipped via local SHA-256 cache`
    );

    // 2. Zotify (librespot-python) 320kbps MP3 download
    setTimeout(() => {
      setActivePipelineNotice(`Zotify (librespot): Downloading "${newSongTitle}" as 320kbps MP3...`);
      addLog(
        target.name,
        `Zotify (librespot-python): Downloaded "${newSongTitle}" (320kbps MP3)`,
        'download',
        `Saved to public/audio/${newTrackId}.mp3`
      );

      setPlaylists((prev) =>
        prev.map((p) =>
          p.id === target.id
            ? {
                ...p,
                tracks: p.tracks.map((t) =>
                  t.id === newTrackId
                    ? { ...t, zotifyStatus: 'downloaded', yotoTranscodeStatus: 'uploading' }
                    : t
                ),
              }
            : p
        )
      );

      // 3. Yoto API Steps 1-3: /uploadUrl -> PUT audio -> Poll /transcoded for transcodedSha256
      setTimeout(() => {
        const uploadId = `upl_${newTrackId}`;
        setActivePipelineNotice(
          `Yoto API: PUT audio to /uploadUrl & polling /media/upload/${uploadId}/transcoded...`
        );
        addLog(
          target.name,
          `Yoto API Steps 1-3: Uploaded MP3 & polling transcode (${uploadId})`,
          'info',
          `GET /media/transcode/audio/uploadUrl -> PUT audio/mpeg -> Poll /transcoded`
        );

        setPlaylists((prev) =>
          prev.map((p) =>
            p.id === target.id
              ? {
                  ...p,
                  tracks: p.tracks.map((t) =>
                    t.id === newTrackId ? { ...t, yotoTranscodeStatus: 'transcoding' } : t
                  ),
                }
              : p
          )
        );

        // 4. Yoto API Step 4: Save transcodedSha256 to cache & POST /content
        setTimeout(() => {
          const sha256 = makeSimulatedSha256(newTrackId);
          setPlaylists((prev) =>
            prev.map((p) =>
              p.id === target.id
                ? {
                    ...p,
                    syncConfig: p.syncConfig
                      ? { ...p.syncConfig, lastCheck: 'Just now' }
                      : undefined,
                    tracks: p.tracks.map((t) =>
                      t.id === newTrackId
                        ? {
                            ...t,
                            inLocalCache: true,
                            zotifyStatus: 'cached',
                            yotoTranscodeStatus: 'transcoded',
                            transcodedSha256: sha256,
                            syncedAt: 'Just now',
                          }
                        : t
                    ),
                  }
                : p
            )
          );

          addLog(
            target.name,
            `Step 4 POST /content: Updated MYO Card ${cardId}`,
            'success',
            `Cached ${newTrackId} -> yoto:#${sha256.slice(0, 16)}... in sync_cache.db`
          );
          setActivePipelineNotice(null);
        }, 1100);
      }, 900);
    }, 800);
  };

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
          {/* Simulation Button */}
          <button
            onClick={simulateSpotifyUpdate}
            className="hidden md:flex items-center space-x-2 bg-white/5 hover:bg-white/10 text-spotify-green px-3 py-1.5 rounded-full border border-spotify-green/20 transition-all hover:border-spotify-green/50"
          >
            <Play size={14} className="fill-current" />
            <span>Simulate New Spotify Track</span>
          </button>

          <div className="w-px h-4 bg-gray-700 hidden md:block"></div>

          <button
            onClick={() => setCurrentScreen('settings')}
            className={`flex items-center space-x-1 hover:text-white transition-colors ${
              currentScreen === 'settings' ? 'text-white' : ''
            }`}
          >
            <Settings size={16} />
            <span>Config</span>
          </button>

          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-pointer hover:ring-2 ring-white/20">
            JD
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {/* Live Pipeline Banner when simulating or syncing */}
        {activePipelineNotice && (
          <div className="mb-6 bg-yoto-orange/15 border border-yoto-orange/40 text-yoto-orange px-4 py-3 rounded-xl flex items-center justify-between text-xs font-medium animate-pulse">
            <div className="flex items-center space-x-2">
              <DownloadCloud size={16} />
              <span>{activePipelineNotice}</span>
            </div>
            <span className="font-mono text-[11px] text-white/80">Zotify &rarr; Yoto 4-Step API</span>
          </div>
        )}

        {currentScreen === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in-up">
            {/* Left Column: Main Dashboard */}
            <div className="lg:col-span-2 space-y-8">
              {/* Welcome/Status Widget */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-spotify-green/20 to-yoto-orange/20 p-8 border border-white/5">
                <div className="relative z-10">
                  <h2 className="text-3xl font-extrabold mb-2">System Active.</h2>
                  <p className="text-gray-300 text-lg mb-4 max-w-xl">
                    Monitoring{' '}
                    <strong>{playlists.filter((p) => p.syncConfig?.enabled).length} playlists</strong>{' '}
                    via Spotipy. Uncached tracks are pulled as 320kbps MP3s with{' '}
                    <strong>Zotify</strong> and uploaded via the{' '}
                    <strong>Yoto 4-Step MYO API</strong>.
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
                      <span>Spotipy + Zotify (librespot)</span>
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
                      <span>Yoto Developer API (/content)</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-full border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                      <Database size={12} />
                      <span>
                        {totalCachedCount}/{totalTracksCount} Cached (transcodedSha256)
                      </span>
                    </div>
                    {totalUncachedCount > 0 && (
                      <div className="flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-full border bg-amber-500/10 border-amber-500/30 text-amber-300">
                        <DownloadCloud size={12} />
                        <span>{totalUncachedCount} Need Spotify Pull</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Toggle View */}
              <div className="flex items-center justify-between">
                <div className="flex space-x-4">
                  <button
                    onClick={() => setDashboardView('spotify')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                      dashboardView === 'spotify'
                        ? 'bg-white text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <ListMusic size={16} />
                    <span>Spotify Sources</span>
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
                    <span>My Yoto Cards</span>
                  </button>
                </div>
              </div>

              {/* Grid Content */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {dashboardView === 'spotify' ? (
                  <>
                    {playlists.map((playlist) => (
                      <PlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        onClick={handlePlaylistSelect}
                      />
                    ))}
                    <div className="border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center p-6 text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-all cursor-pointer min-h-[250px] group">
                      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <span className="text-2xl">+</span>
                      </div>
                      <span className="font-medium">Add Source</span>
                    </div>
                  </>
                ) : (
                  <>
                    {playlists
                      .filter((p) => p.syncConfig?.enabled)
                      .map((playlist) => {
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
                                    playlist.generatedIcon || new Array(256).fill('#000')
                                  }
                                  themeColor={playlist.themeColor || '#333'}
                                  isSyncing={false}
                                />
                              </div>
                              <h3 className="text-center font-bold text-white text-sm truncate">
                                {playlist.name}
                              </h3>
                              <div className="flex items-center justify-center gap-1.5 mt-2">
                                <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                  MYO Active
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
                    {playlists.filter((p) => p.syncConfig?.enabled).length === 0 && (
                      <div className="col-span-full py-12 text-center text-gray-500">
                        <p>
                          No synced cards yet. Go to "Spotify Sources" and enable sync on a
                          playlist.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right Column: Sidebar */}
            <div className="space-y-6">
              {/* Quick Connect & Local Cache Summary Panel */}
              <div className="bg-gray-900 rounded-2xl p-6 border border-white/10 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                    Services &amp; Cache
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                    <div>
                      <span className="font-medium text-sm block">Spotify + Zotify</span>
                      <span className="text-[11px] text-gray-400">
                        Spotipy API &amp; librespot 320kbps
                      </span>
                    </div>
                    <button
                      onClick={() => toggleConnection('spotify')}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        connections.spotify
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-white/5 text-gray-500'
                      }`}
                    >
                      {connections.spotify ? 'Connected' : 'Disconnected'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                    <div>
                      <span className="font-medium text-sm block">Yoto Developer API</span>
                      <span className="text-[11px] text-gray-400">
                        4-Step /uploadUrl &rarr; /content
                      </span>
                    </div>
                    <button
                      onClick={() => toggleConnection('yoto')}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        connections.yoto
                          ? 'bg-yoto-orange/15 text-yoto-orange'
                          : 'bg-white/5 text-gray-500'
                      }`}
                    >
                      {connections.yoto ? 'Connected' : 'Disconnected'}
                    </button>
                  </div>
                </div>

                {/* Local Cache Breakdown */}
                <div className="pt-2 border-t border-white/10 text-xs space-y-2">
                  <div className="flex items-center justify-between text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <Database size={13} className="text-emerald-400" />
                      Cached in <code className="text-gray-300">sync_cache.db</code>
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {totalCachedCount} tracks
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <DownloadCloud size={13} className="text-amber-400" />
                      Pending Spotify Zotify Pull
                    </span>
                    <span className="font-mono text-amber-300 font-bold">
                      {totalUncachedCount} tracks
                    </span>
                  </div>
                </div>
              </div>

              {/* Activity Feed */}
              <div className="h-[500px]">
                <ActivityFeed logs={logs} />
              </div>
            </div>
          </div>
        )}

        {currentScreen === 'detail' && selectedPlaylist && (
          <SyncView
            playlist={selectedPlaylist}
            onBack={handleBack}
            onToggleSync={handleToggleSync}
            onLog={addLog}
            connected={connections.yoto && connections.spotify}
            settings={settings}
          />
        )}

        {currentScreen === 'settings' && (
          <SettingsView
            settings={settings}
            onSave={handleSaveSettings}
            onBack={handleBack}
          />
        )}
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