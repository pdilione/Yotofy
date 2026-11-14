import React, { useState, useEffect } from 'react';
import { Playlist, Track, AppSettings, ActivityLog } from '../types';
import { YotoDisplay } from './YotoDisplay';
import { getPlaylists, triggerSync } from '../services/api';
import {
  CheckCircle,
  RefreshCw,
  Link,
  HardDrive,
  DownloadCloud,
  Database,
  Radio,
  Hash,
  AlertCircle,
} from 'lucide-react';

interface Props {
  playlist: Playlist;
  onBack: () => void;
  onPlaylistSynced: (updatedPlaylist: Playlist, updatedActivity?: ActivityLog[]) => void;
  connected: boolean;
  settings: AppSettings;
}

export const SyncView: React.FC<Props> = ({
  playlist,
  onBack,
  onPlaylistSynced,
  connected,
  settings,
}) => {
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist>(playlist);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(
    Boolean(playlist.syncConfig?.enabled)
  );

  const emptyGrid = new Array(256).fill('#111111');

  // Refresh real playlist state from /api/playlists on mount
  useEffect(() => {
    let mounted = true;
    setCurrentPlaylist(playlist);
    setAutoSyncEnabled(Boolean(playlist.syncConfig?.enabled));

    getPlaylists()
      .then((list) => {
        if (!mounted) return;
        const fresh = list.find((p) => p.id === playlist.id);
        if (fresh) {
          setCurrentPlaylist(fresh);
          setAutoSyncEnabled(Boolean(fresh.syncConfig?.enabled));
        }
      })
      .catch(() => {
        // Keep currentPlaylist prop if fetch fails
      });

    return () => {
      mounted = false;
    };
  }, [playlist.id]);

  const tracks: Track[] = currentPlaylist.tracks || [];
  const cachedCount = tracks.filter((t) => t.inLocalCache && t.transcodedSha256).length;
  const uncachedCount = tracks.length - cachedCount;
  const isSynced = Boolean(currentPlaylist.syncConfig?.enabled);

  const handleSync = async () => {
    if (!connected || syncing) return;
    setSyncing(true);
    setSyncError(null);

    try {
      const result = await triggerSync({
        playlistId: currentPlaylist.id,
        autoSync: autoSyncEnabled,
        targetYotoId: currentPlaylist.syncConfig?.targetYotoId || settings.yotoCardId,
      });

      if (result.playlist) {
        setCurrentPlaylist(result.playlist);
        onPlaylistSynced(result.playlist, result.activity);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center mb-6 justify-between gap-4">
        <div className="flex items-center">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white mr-4 transition-colors font-medium"
          >
            &larr; Back
          </button>
          <h2 className="text-2xl font-bold text-white flex items-center">
            {currentPlaylist.imageUrl && (
              <img
                src={currentPlaylist.imageUrl}
                alt={currentPlaylist.name}
                className="w-8 h-8 rounded mr-3"
              />
            )}
            {currentPlaylist.name}
          </h2>
        </div>

        {/* Cache & Source Summary Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/30 text-xs text-emerald-300">
            <Database size={12} />
            <span>{cachedCount} Cached (SHA-256)</span>
          </div>
          <div
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-full border text-xs ${
              uncachedCount > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 text-gray-400'
            }`}
          >
            <DownloadCloud size={12} />
            <span>{uncachedCount} Needs Zotify Pull</span>
          </div>
          <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 text-xs text-gray-400">
            <span>Engine:</span>
            <span className="text-white flex items-center font-medium">
              {settings.audioProvider === 'local_library' ? (
                <>
                  <HardDrive size={12} className="mr-1 text-blue-400" /> Local MP3 Cache
                </>
              ) : (
                <>
                  <Radio size={12} className="mr-1 text-spotify-green" /> Zotify (librespot 320kbps)
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden">
        {/* Left: Real Track List */}
        <div className="bg-spotify-light/50 rounded-2xl p-6 flex flex-col h-full overflow-hidden border border-white/5 shadow-inner">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-gray-300 text-sm font-bold uppercase tracking-wider">
                Spotify Playlist Tracks ({tracks.length})
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Cached tracks in <code className="text-gray-400">data/state.json</code> skip re-uploading
              </p>
            </div>
            {isSynced && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <CheckCircle size={11} />
                Synced
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 max-h-[540px]">
            {tracks.length === 0 ? (
              <div className="text-center text-gray-500 text-xs py-12">
                No tracks found in this playlist.
              </div>
            ) : (
              tracks.map((track, idx) => {
                const isCached = Boolean(track.inLocalCache && track.transcodedSha256);

                return (
                  <div
                    key={track.id}
                    className={`flex items-center p-2.5 rounded-xl border transition-all ${
                      isCached
                        ? 'bg-white/[0.03] border-white/5'
                        : 'bg-amber-500/[0.04] border-amber-500/20'
                    }`}
                  >
                    <span className="text-gray-500 w-7 text-center text-xs font-mono">
                      {idx + 1}
                    </span>
                    {track.imageUrl && (
                      <img
                        src={track.imageUrl}
                        alt={track.title}
                        className="w-10 h-10 rounded mr-3"
                      />
                    )}
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="text-white truncate font-medium text-sm">{track.title}</div>
                      <div className="text-gray-400 text-xs truncate">
                        {track.artist} •{' '}
                        <span className="text-gray-500 font-mono">{track.duration}</span>
                      </div>
                      {track.transcodedSha256 && (
                        <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5 flex items-center gap-1 truncate">
                          <Hash size={10} />
                          <span>yoto:#{track.transcodedSha256.slice(0, 20)}...</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end flex-shrink-0">
                      {isCached ? (
                        <span className="text-[11px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                          <CheckCircle size={11} />
                          Cached
                        </span>
                      ) : (
                        <span className="text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                          <DownloadCloud size={11} />
                          Needs Zotify Pull
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Yoto Sync Control */}
        <div className="flex flex-col items-center justify-between p-6 bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl border border-white/5 relative overflow-hidden">
          <div className="w-full flex justify-between items-center z-10 mb-2">
            <div className="flex items-center space-x-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  syncing
                    ? 'bg-yoto-orange animate-pulse'
                    : isSynced
                    ? 'bg-green-500'
                    : 'bg-gray-600'
                }`}
              />
              <span className="text-gray-200 text-xs font-bold uppercase tracking-widest">
                {syncing ? 'Syncing with Yoto API...' : isSynced ? 'Synced' : 'Not Synced'}
              </span>
            </div>
            {currentPlaylist.syncConfig?.targetYotoId && (
              <span className="text-xs font-mono text-yoto-orange bg-yoto-orange/10 px-2.5 py-1 rounded-full border border-yoto-orange/30 flex items-center gap-1">
                <Link size={12} />
                {currentPlaylist.syncConfig.targetYotoId}
              </span>
            )}
          </div>

          <div className="w-48 sm:w-56 my-4">
            <YotoDisplay
              iconGrid={currentPlaylist.generatedIcon || emptyGrid}
              themeColor={currentPlaylist.themeColor || '#FF6D00'}
              isSyncing={syncing}
            />
          </div>

          <div className="w-full max-w-md space-y-3">
            <div className="bg-black/20 rounded-xl p-3.5 border border-white/5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <RefreshCw
                    className={`text-gray-400 ${autoSyncEnabled ? 'text-yoto-orange' : ''}`}
                    size={16}
                  />
                  <span className="font-medium text-sm text-white">Auto-Sync Playlist</span>
                </div>
                <button
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${
                    autoSyncEnabled ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
                      autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Persists sync state and track <code className="text-gray-300">transcodedSha256</code>{' '}
                hashes in <code className="text-gray-300">data/state.json</code>.
              </p>
            </div>

            {syncError && (
              <div className="bg-red-500/10 text-red-200 p-3 rounded-xl text-xs border border-red-500/20 flex items-center gap-2">
                <AlertCircle size={15} className="text-red-400 flex-shrink-0" />
                <span>{syncError}</span>
              </div>
            )}

            {!connected ? (
              <div className="bg-red-500/10 text-red-200 p-3 rounded-xl text-xs border border-red-500/20 text-center">
                Disconnected: Configure <code>SPOTIPY_CLIENT_ID</code>,{' '}
                <code>SPOTIPY_CLIENT_SECRET</code>, and <code>YOTO_ACCESS_TOKEN</code> in{' '}
                <code>.env</code> to sync.
              </div>
            ) : (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full bg-yoto-orange hover:bg-yoto-red disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-full shadow-lg transition-all flex items-center justify-center space-x-2 text-sm"
              >
                <Link size={18} />
                <span>
                  {syncing
                    ? 'Running POST /api/sync...'
                    : `Sync Playlist (${uncachedCount} uncached)`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};