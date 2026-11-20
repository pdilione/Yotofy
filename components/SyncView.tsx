import React, { useState, useEffect } from 'react';
import { Playlist, Track, AppSettings, ActivityLog, YotoMyoCard } from '../types';
import { YotoDisplay } from './YotoDisplay';
import { getPlaylists, getStatus, triggerSync } from '../services/api';
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
  PlusCircle,
  Disc,
} from 'lucide-react';

const CREATE_NEW_OPTION = '__create_new__';

interface Props {
  playlist: Playlist;
  onBack: () => void;
  onPlaylistSynced: (
    updatedPlaylist: Playlist,
    updatedActivity?: ActivityLog[],
    updatedYotoCards?: YotoMyoCard[]
  ) => void;
  connected: boolean;
  settings: AppSettings;
  yotoCards?: YotoMyoCard[];
  onOpenLogs?: () => void;
}

export const SyncView: React.FC<Props> = ({
  playlist,
  onBack,
  onPlaylistSynced,
  connected,
  settings,
  yotoCards = [],
  onOpenLogs,
}) => {
  const [currentPlaylist, setCurrentPlaylist] = useState<Playlist>(playlist);
  const [availableYotoCards, setAvailableYotoCards] = useState<YotoMyoCard[]>(yotoCards);
  const [targetSelection, setTargetSelection] = useState<string>(() =>
    playlist.syncConfig?.targetYotoId || CREATE_NEW_OPTION
  );
  const [newPlaylistTitle, setNewPlaylistTitle] = useState<string>(playlist.name);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(
    Boolean(playlist.syncConfig?.enabled ?? true)
  );

  const emptyGrid = new Array(256).fill('#111111');

  useEffect(() => {
    setAvailableYotoCards(yotoCards);
  }, [yotoCards]);

  // Refresh real playlist state and Yoto MYO cards on mount
  useEffect(() => {
    let mounted = true;
    setCurrentPlaylist(playlist);
    setNewPlaylistTitle(playlist.name);
    setTargetSelection(playlist.syncConfig?.targetYotoId || CREATE_NEW_OPTION);
    setAutoSyncEnabled(Boolean(playlist.syncConfig?.enabled ?? true));

    Promise.all([
      getPlaylists().catch(() => []),
      getStatus().catch(() => null),
    ]).then(([list, statusRes]) => {
      if (!mounted) return;
      const fresh = list.find((p) => p.id === playlist.id);
      if (fresh) {
        setCurrentPlaylist(fresh);
        if (fresh.syncConfig?.targetYotoId) {
          setTargetSelection(fresh.syncConfig.targetYotoId);
        }
        setAutoSyncEnabled(Boolean(fresh.syncConfig?.enabled ?? true));
      }
      if (statusRes && Array.isArray(statusRes.yotoCards)) {
        setAvailableYotoCards(statusRes.yotoCards);
      }
    });

    return () => {
      mounted = false;
    };
  }, [playlist.id]);

  const tracks: Track[] = currentPlaylist.tracks || [];
  const cachedCount = tracks.filter((t) => t.inLocalCache && t.transcodedSha256).length;
  const uncachedCount = tracks.length - cachedCount;
  const isSynced = Boolean(currentPlaylist.syncConfig?.enabled);
  const isCreatingNew = targetSelection === CREATE_NEW_OPTION;

  const mappedCardId = currentPlaylist.syncConfig?.targetYotoId;
  const hasMappedInList = Boolean(
    mappedCardId && availableYotoCards.some((c) => c.cardId === mappedCardId)
  );

  const handleSync = async () => {
    if (!connected || syncing) return;
    setSyncing(true);
    setSyncError(null);

    const createNew = targetSelection === CREATE_NEW_OPTION;
    const trimmedTitle = newPlaylistTitle.trim() || currentPlaylist.name;

    try {
      const result = await triggerSync({
        playlistId: currentPlaylist.id,
        autoSync: autoSyncEnabled,
        createNew,
        targetYotoId: createNew ? undefined : targetSelection,
        customTitle: createNew ? trimmedTitle : undefined,
      });

      const returnedCardId =
        result.cardId || result.playlist?.syncConfig?.targetYotoId;

      if (Array.isArray(result.yotoCards)) {
        setAvailableYotoCards(result.yotoCards);
      }

      if (result.playlist) {
        setCurrentPlaylist(result.playlist);
        if (returnedCardId) {
          setTargetSelection(returnedCardId);
        }
        onPlaylistSynced(result.playlist, result.activity, result.yotoCards);
      } else if (returnedCardId) {
        setTargetSelection(returnedCardId);
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
            {currentPlaylist.imageUrl && currentPlaylist.imageUrl.trim() && (
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
                const iconPreviewUrl = `/api/icons/preview?url=${encodeURIComponent(
                  track.imageUrl || currentPlaylist.imageUrl || ''
                )}&seed=${encodeURIComponent(`${track.id}:${track.title}`)}`;

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
                    <div className="relative mr-3 flex items-center gap-1.5 shrink-0">
                      {track.imageUrl && track.imageUrl.trim() && (
                        <img
                          src={track.imageUrl}
                          alt={track.title}
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                      <div
                        title="Dynamic 16×16 Yoto LED Pixel Icon generated from album art"
                        className="w-10 h-10 rounded bg-black/80 border border-yoto-orange/40 p-1 flex items-center justify-center shadow-inner"
                      >
                        <img
                          src={iconPreviewUrl}
                          alt={`16x16 Yoto Icon for ${track.title}`}
                          className="w-full h-full [image-rendering:pixelated]"
                        />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="text-white truncate font-medium text-sm">{track.title}</div>
                      <div className="text-gray-400 text-xs truncate">
                        {track.artist} •{' '}
                        <span className="text-gray-500 font-mono">{track.duration}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        {track.transcodedSha256 && (
                          <div className="text-[10px] text-emerald-400/80 font-mono flex items-center gap-1 truncate">
                            <Hash size={10} />
                            <span>yoto:#{track.transcodedSha256.slice(0, 14)}...</span>
                          </div>
                        )}
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-yoto-orange/15 text-yoto-orange border border-yoto-orange/30">
                          {track.iconMediaId
                            ? `16×16 Icon: yoto:#${track.iconMediaId.slice(0, 10)}...`
                            : '16×16 Album Icon Ready'}
                        </span>
                      </div>
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
        <div className="flex flex-col items-center justify-between p-6 bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl border border-white/5 relative overflow-hidden space-y-4">
          <div className="w-full flex justify-between items-center z-10">
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
                {syncing ? 'Syncing with Yoto API...' : isSynced ? 'Synced' : 'Ready to Sync'}
              </span>
            </div>
            {currentPlaylist.syncConfig?.targetYotoId && (
              <span className="text-xs font-mono text-yoto-orange bg-yoto-orange/10 px-2.5 py-1 rounded-full border border-yoto-orange/30 flex items-center gap-1">
                <Link size={12} />
                cardId: {currentPlaylist.syncConfig.targetYotoId}
              </span>
            )}
          </div>

          {/* Target Yoto Playlist Dropdown + Create New Option (Placed at Top of Panel) */}
          <div className="w-full bg-black/40 rounded-xl p-4 border border-yoto-orange/30 space-y-3">
            <div>
              <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                <Disc size={14} className="text-yoto-orange" />
                <span>Target Yoto MYO Playlist</span>
              </label>
              <select
                value={targetSelection}
                onChange={(e) => setTargetSelection(e.target.value)}
                className="w-full bg-gray-900 border border-white/20 rounded-lg px-3 py-2.5 text-white text-xs font-semibold focus:border-yoto-orange focus:outline-none"
              >
                <option value={CREATE_NEW_OPTION}>+ Create New Yoto Playlist</option>
                {mappedCardId && !hasMappedInList && (
                  <option value={mappedCardId}>
                    Mapped MYO Playlist ({mappedCardId})
                  </option>
                )}
                {availableYotoCards.map((card) => (
                  <option key={card.cardId} value={card.cardId}>
                    {card.title} ({card.cardId})
                  </option>
                ))}
              </select>
            </div>

            {isCreatingNew && (
              <div>
                <label className="block text-[11px] font-bold text-yoto-orange mb-1 flex items-center gap-1">
                  <PlusCircle size={12} />
                  <span>New Yoto Playlist Title</span>
                </label>
                <input
                  type="text"
                  value={newPlaylistTitle}
                  onChange={(e) => setNewPlaylistTitle(e.target.value)}
                  placeholder={currentPlaylist.name}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-xs focus:border-yoto-orange focus:outline-none"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Creates a brand-new MYO playlist on Yoto (omitting <code>cardId</code>) and saves
                  the new <code>cardId</code> for future syncs.
                </p>
              </div>
            )}
          </div>

          <div className="w-36 sm:w-44">
            <YotoDisplay
              iconGrid={currentPlaylist.generatedIcon || emptyGrid}
              themeColor={currentPlaylist.themeColor || '#FF6D00'}
              isSyncing={syncing}
            />
          </div>

          <div className="w-full space-y-3">
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
                  type="button"
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
                Persists mapped <code className="text-gray-300">cardId</code> and track{' '}
                <code className="text-gray-300">transcodedSha256</code> hashes in{' '}
                <code className="text-gray-300">data/state.json</code>.
              </p>
            </div>

            {syncError && (
              <div className="bg-red-500/10 text-red-200 p-3.5 rounded-xl text-xs border border-red-500/30 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-red-300">
                    <AlertCircle size={15} className="text-red-400 shrink-0" />
                    <span>Sync Failed — Diagnostic Output</span>
                  </div>
                  {onOpenLogs && (
                    <button
                      type="button"
                      onClick={onOpenLogs}
                      className="text-[11px] bg-red-500/20 hover:bg-red-500/30 text-red-200 px-2.5 py-1 rounded-lg border border-red-500/30 font-medium whitespace-nowrap shrink-0"
                    >
                      Open System Logs &rarr;
                    </button>
                  )}
                </div>
                <pre className="text-[11px] font-mono text-red-100 bg-black/50 p-2.5 rounded-lg border border-red-500/20 whitespace-pre-wrap break-words max-h-48 overflow-y-auto custom-scrollbar">
                  {syncError}
                </pre>
              </div>
            )}

            {!connected ? (
              <div className="bg-red-500/10 text-red-200 p-3 rounded-xl text-xs border border-red-500/20 text-center">
                Disconnected: Connect both Spotify and Yoto via OAuth 2.0 PKCE in{' '}
                <strong>Config</strong> before syncing.
              </div>
            ) : (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full bg-yoto-orange hover:bg-yoto-red disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-full shadow-lg transition-all flex items-center justify-center space-x-2 text-sm"
              >
                {isCreatingNew ? <PlusCircle size={18} /> : <Link size={18} />}
                <span>
                  {syncing
                    ? isCreatingNew
                      ? 'Creating New Yoto Playlist...'
                      : 'Updating Yoto Playlist...'
                    : isCreatingNew
                    ? `Create & Sync Yoto Playlist (${uncachedCount} uncached)`
                    : `Sync to ${targetSelection} (${uncachedCount} uncached)`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};