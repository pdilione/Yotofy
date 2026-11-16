import React, { useState, useEffect, useCallback } from 'react';
import {
  Playlist,
  YotoMyoCard,
  YotoCardTrackItem,
  AppSettings,
  ActivityLog,
} from '../types';
import { YotoDisplay } from './YotoDisplay';
import { getYotoCardDetail, getPlaylists, triggerSync } from '../services/api';
import {
  RefreshCw,
  Disc,
  Music,
  CheckCircle,
  DownloadCloud,
  AlertCircle,
  ArrowRight,
  Clock,
  Hash,
  ListMusic,
  Link as LinkIcon,
} from 'lucide-react';

interface Props {
  card: YotoMyoCard;
  playlists: Playlist[];
  connected: boolean;
  settings: AppSettings;
  onBack: () => void;
  onOpenSpotifyPlaylist: (playlist: Playlist, targetCardId: string) => void;
  onCardSynced: (
    updatedPlaylist: Playlist,
    updatedActivity?: ActivityLog[],
    updatedYotoCards?: YotoMyoCard[]
  ) => void;
}

function formatSeconds(sec?: number): string {
  if (!sec || sec <= 0) return '—';
  const total = Math.round(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatTotalDuration(sec?: number): string {
  if (!sec || sec <= 0) return '—';
  const total = Math.round(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}

function formatDate(iso?: string): string {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const YotoCardDetailView: React.FC<Props> = ({
  card,
  playlists,
  connected,
  onBack,
  onOpenSpotifyPlaylist,
  onCardSynced,
}) => {
  const [cardDetail, setCardDetail] = useState<YotoMyoCard>(card);
  const [availablePlaylists, setAvailablePlaylists] = useState<Playlist[]>(playlists);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(true);

  const findInitialPlaylistId = useCallback(
    (cardData: YotoMyoCard, plList: Playlist[]): string => {
      if (cardData.linkedSpotifyPlaylistId) {
        const byLink = plList.find((p) => p.id === cardData.linkedSpotifyPlaylistId);
        if (byLink) return byLink.id;
      }
      const mapped = plList.find(
        (p) => p.syncConfig?.targetYotoId === cardData.cardId
      );
      if (mapped) return mapped.id;
      const nameMatch = plList.find(
        (p) => p.name.toLowerCase().trim() === cardData.title.toLowerCase().trim()
      );
      if (nameMatch) return nameMatch.id;
      return plList[0]?.id || '';
    },
    []
  );

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(() =>
    findInitialPlaylistId(card, playlists)
  );
  const [customCardTitle, setCustomCardTitle] = useState<string>(card.title);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccessMessage, setSyncSuccessMessage] = useState<string | null>(null);

  const emptyGrid = new Array(256).fill('#111111');

  const refreshCardDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const [detailData, freshPlaylists] = await Promise.all([
        getYotoCardDetail(card.cardId).catch(() => card),
        availablePlaylists.length > 0
          ? Promise.resolve(availablePlaylists)
          : getPlaylists().catch(() => []),
      ]);
      setCardDetail((prev) => ({
        ...prev,
        ...detailData,
        coverImageUrl: detailData.coverImageUrl || prev.coverImageUrl,
      }));
      if (freshPlaylists.length > 0) {
        setAvailablePlaylists(freshPlaylists);
        setSelectedPlaylistId((prevId) =>
          prevId || findInitialPlaylistId(detailData, freshPlaylists)
        );
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [card, availablePlaylists, findInitialPlaylistId]);

  useEffect(() => {
    setCardDetail(card);
    setCustomCardTitle(card.title);
    refreshCardDetail();
  }, [card.cardId]);

  useEffect(() => {
    if (playlists.length > 0) {
      setAvailablePlaylists(playlists);
      if (!selectedPlaylistId) {
        setSelectedPlaylistId(findInitialPlaylistId(cardDetail, playlists));
      }
    }
  }, [playlists, cardDetail, selectedPlaylistId, findInitialPlaylistId]);

  const selectedSpotifyPlaylist =
    availablePlaylists.find((p) => p.id === selectedPlaylistId) || null;

  const linkedPlaylist =
    availablePlaylists.find(
      (p) =>
        p.syncConfig?.targetYotoId === cardDetail.cardId ||
        p.id === cardDetail.linkedSpotifyPlaylistId
    ) || null;

  // Build tracks currently on the Yoto card (or from linked playlist if synced locally)
  const cardTracks: YotoCardTrackItem[] =
    cardDetail.tracks && cardDetail.tracks.length > 0
      ? cardDetail.tracks
      : linkedPlaylist
      ? linkedPlaylist.tracks
          .filter((t) => t.transcodedSha256)
          .map((t, idx) => ({
            key: String(idx + 1).padStart(2, '0'),
            title: t.title,
            artist: t.artist,
            transcodedSha256: t.transcodedSha256,
            trackUrl: t.transcodedSha256 ? `yoto:#${t.transcodedSha256}` : undefined,
            fileSize: t.fileSize,
            format: 'aac',
            channels: 'stereo',
          }))
      : [];

  const incomingTracks = selectedSpotifyPlaylist?.tracks || [];
  const cachedIncomingCount = incomingTracks.filter(
    (t) => t.inLocalCache && t.transcodedSha256
  ).length;
  const uncachedIncomingCount = incomingTracks.length - cachedIncomingCount;

  const handleSyncToThisCard = async () => {
    if (!selectedSpotifyPlaylist || syncing || !connected) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSuccessMessage(null);

    const effectiveTitle = customCardTitle.trim() || cardDetail.title;

    try {
      const result = await triggerSync({
        playlistId: selectedSpotifyPlaylist.id,
        autoSync: autoSyncEnabled,
        createNew: false,
        targetYotoId: cardDetail.cardId,
        customTitle: effectiveTitle,
      });

      if (result.playlist) {
        setAvailablePlaylists((prev) =>
          prev.map((p) => (p.id === result.playlist!.id ? result.playlist! : p))
        );
        onCardSynced(result.playlist, result.activity, result.yotoCards);
      }

      const refreshed = await getYotoCardDetail(cardDetail.cardId).catch(() => null);
      if (refreshed) {
        setCardDetail((prev) => ({
          ...prev,
          ...refreshed,
          title: effectiveTitle,
          coverImageUrl: refreshed.coverImageUrl || prev.coverImageUrl,
        }));
      }

      setSyncSuccessMessage(
        `Synced "${selectedSpotifyPlaylist.name}" (${incomingTracks.length} tracks) to Yoto card "${effectiveTitle}" (${cardDetail.cardId}).`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync to Yoto card');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors text-sm font-medium whitespace-nowrap shrink-0"
          >
            &larr; Back
          </button>

          {cardDetail.coverImageUrl && cardDetail.coverImageUrl.trim() ? (
            <img
              src={cardDetail.coverImageUrl}
              alt={cardDetail.title}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-yoto-orange/15 border border-yoto-orange/30 flex items-center justify-center shrink-0">
              <Disc size={22} className="text-yoto-orange" />
            </div>
          )}

          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-white truncate">{cardDetail.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 font-mono tabular-nums mt-0.5">
              <span>cardId: {cardDetail.cardId}</span>
              <span aria-hidden="true">·</span>
              <span>
                {cardTracks.length || cardDetail.trackCount || 0} tracks
              </span>
              {cardDetail.totalDuration ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatTotalDuration(cardDetail.totalDuration)}</span>
                </>
              ) : null}
              <span aria-hidden="true">·</span>
              <span>Updated {formatDate(cardDetail.updatedAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={refreshCardDetail}
            disabled={loadingDetail}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-200 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw size={14} className={loadingDetail ? 'animate-spin' : ''} />
            <span>Refresh Card Details</span>
          </button>
        </div>
      </div>

      {/* Main Two-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (7 cols): Yoto Card Details & Current Tracklist */}
        <div className="lg:col-span-7 bg-gray-900 rounded-2xl p-6 border border-white/10 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-base font-bold text-white">
                Yoto MYO Card Contents
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {cardDetail.description ||
                  'Physical Make Your Own (MYO) playlist stored in your Yoto Cloud library.'}
              </p>
            </div>

            <div className="text-right text-xs text-gray-400 font-mono tabular-nums">
              {linkedPlaylist ? (
                <span className="text-emerald-400">
                  Linked to Spotify: {linkedPlaylist.name}
                </span>
              ) : (
                <span>No Spotify playlist linked yet</span>
              )}
            </div>
          </div>

          {/* Card Metadata Summary Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 px-4 bg-black/30 rounded-xl border border-white/5 text-xs">
            <div>
              <span className="text-gray-500 block">Card ID</span>
              <span className="text-white font-mono tabular-nums font-semibold mt-0.5 block">
                {cardDetail.cardId}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block">Tracks on Card</span>
              <span className="text-white font-mono tabular-nums font-semibold mt-0.5 block">
                {cardTracks.length || cardDetail.trackCount || 0}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block">Playback Mode</span>
              <span className="text-white font-semibold capitalize mt-0.5 block">
                {cardDetail.playbackType || 'Linear'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block">Last Updated</span>
              <span className="text-white font-mono tabular-nums font-semibold mt-0.5 block">
                {formatDate(cardDetail.updatedAt)}
              </span>
            </div>
          </div>

          {/* Current Tracks on Yoto Card */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400 pb-1">
              <span>Current Card Tracklist</span>
              <span className="font-mono tabular-nums">
                {cardTracks.length} {cardTracks.length === 1 ? 'track' : 'tracks'}
              </span>
            </div>

            {loadingDetail && cardTracks.length === 0 ? (
              <div className="space-y-2 py-6">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-12 rounded-xl bg-white/5 animate-pulse border border-white/5"
                  />
                ))}
              </div>
            ) : cardTracks.length > 0 ? (
              <div className="max-h-[460px] overflow-y-auto custom-scrollbar pr-1 space-y-2">
                {cardTracks.map((track, idx) => (
                  <div
                    key={`${track.key}-${idx}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-3">
                      <span className="w-6 text-center text-xs font-mono tabular-nums text-gray-500 shrink-0">
                        {track.key || String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-yoto-orange/15 border border-yoto-orange/25 flex items-center justify-center shrink-0">
                        <Music size={14} className="text-yoto-orange" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {track.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-400 truncate">
                          {track.artist && <span>{track.artist}</span>}
                          {track.artist && track.transcodedSha256 && (
                            <span aria-hidden="true">·</span>
                          )}
                          {track.transcodedSha256 && (
                            <span className="font-mono text-[11px] text-emerald-400/80 flex items-center gap-1 truncate">
                              <Hash size={10} />
                              yoto:#{track.transcodedSha256.slice(0, 16)}...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-400 font-mono tabular-nums shrink-0">
                      {track.format && (
                        <span className="uppercase text-gray-500">{track.format}</span>
                      )}
                      {track.duration ? (
                        <span className="flex items-center gap-1">
                          <Clock size={11} className="text-gray-500" />
                          {formatSeconds(track.duration)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 px-6 text-center bg-black/30 rounded-xl border border-white/5 space-y-2">
                <Disc size={28} className="text-yoto-orange mx-auto opacity-80" />
                <p className="text-sm font-semibold text-white">
                  Ready to Sync Tracks to "{cardDetail.title}"
                </p>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  Select a Spotify playlist in the Sync panel on the right and click{' '}
                  <strong className="text-white">Sync to This Yoto Card</strong> to download,
                  transcode, and populate <code className="text-yoto-orange">{cardDetail.cardId}</code>.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Sync a Spotify Playlist to This Yoto Card */}
        <div className="lg:col-span-5 bg-gray-900 rounded-2xl p-6 border border-white/10 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h3 className="text-base font-bold text-white">
                Sync Spotify Playlist to Card
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Target Yoto Card ID:{' '}
                <code className="text-yoto-orange font-mono">{cardDetail.cardId}</code>
              </p>
            </div>
            <div className="w-14 h-14 shrink-0">
              {cardDetail.coverImageUrl && cardDetail.coverImageUrl.trim() ? (
                <img
                  src={cardDetail.coverImageUrl}
                  alt={cardDetail.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-xl object-cover border border-white/10"
                />
              ) : (
                <YotoDisplay
                  iconGrid={selectedSpotifyPlaylist?.generatedIcon || emptyGrid}
                  themeColor={selectedSpotifyPlaylist?.themeColor || '#FF6D00'}
                  isSyncing={syncing}
                />
              )}
            </div>
          </div>

          {/* 1. Select Source Spotify Playlist */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-200">
              Source Spotify Playlist
            </label>
            {availablePlaylists.length > 0 ? (
              <select
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
                className="w-full bg-black/50 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-white font-medium focus:border-yoto-orange focus:outline-none"
              >
                {availablePlaylists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.tracks?.length || pl.trackCount || 0} tracks)
                    {pl.syncConfig?.targetYotoId === cardDetail.cardId
                      ? ' — Linked to this card'
                      : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 text-xs text-gray-400">
                No Spotify playlists loaded. Make sure Spotify is connected in Config.
              </div>
            )}
          </div>

          {/* 2. Editable Yoto Card Title */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-gray-200">
                Yoto Card Title on Sync
              </label>
              {selectedSpotifyPlaylist &&
                customCardTitle !== selectedSpotifyPlaylist.name && (
                  <button
                    type="button"
                    onClick={() => setCustomCardTitle(selectedSpotifyPlaylist.name)}
                    className="text-[11px] text-yoto-orange hover:underline whitespace-nowrap"
                  >
                    Use Spotify title ("{selectedSpotifyPlaylist.name}")
                  </button>
                )}
            </div>
            <input
              type="text"
              value={customCardTitle}
              onChange={(e) => setCustomCardTitle(e.target.value)}
              placeholder={cardDetail.title}
              className="w-full bg-black/50 border border-white/15 rounded-xl px-3.5 py-2 text-sm text-white focus:border-yoto-orange focus:outline-none"
            />
          </div>

          {/* 3. Selected Spotify Playlist Track Summary & Preview */}
          {selectedSpotifyPlaylist && (
            <div className="bg-black/30 rounded-xl p-4 border border-white/5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {selectedSpotifyPlaylist.imageUrl &&
                  selectedSpotifyPlaylist.imageUrl.trim() ? (
                    <img
                      src={selectedSpotifyPlaylist.imageUrl}
                      alt={selectedSpotifyPlaylist.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-spotify-green/20 flex items-center justify-center shrink-0">
                      <ListMusic size={16} className="text-spotify-green" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">
                      {selectedSpotifyPlaylist.name}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono tabular-nums">
                      {incomingTracks.length} tracks · {cachedIncomingCount} cached ·{' '}
                      {uncachedIncomingCount} need Zotify download
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onOpenSpotifyPlaylist(selectedSpotifyPlaylist, cardDetail.cardId)
                  }
                  className="text-xs text-gray-300 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <span>Full View</span>
                  <ArrowRight size={12} />
                </button>
              </div>

              {incomingTracks.length > 0 && (
                <div className="max-h-48 overflow-y-auto custom-scrollbar pr-1 space-y-1.5 pt-1 border-t border-white/5">
                  {incomingTracks.map((t, idx) => {
                    const isCached = Boolean(t.inLocalCache && t.transcodedSha256);
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white/[0.02]"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="text-gray-500 font-mono tabular-nums w-5">
                            {idx + 1}.
                          </span>
                          <span className="text-gray-200 truncate">{t.title}</span>
                          <span className="text-gray-500 truncate hidden sm:inline">
                            · {t.artist}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] font-mono whitespace-nowrap shrink-0 flex items-center gap-1 ${
                            isCached ? 'text-emerald-400' : 'text-amber-300'
                          }`}
                        >
                          {isCached ? (
                            <>
                              <CheckCircle size={11} />
                              Cached
                            </>
                          ) : (
                            <>
                              <DownloadCloud size={11} />
                              Zotify
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 4. Auto-Sync Toggle */}
          <div className="flex items-center justify-between py-2.5 px-3.5 bg-black/30 rounded-xl border border-white/5">
            <div>
              <span className="text-xs font-semibold text-white block">
                Auto-Sync Linked Playlist
              </span>
              <span className="text-[11px] text-gray-400">
                Keep card <code className="text-gray-300">{cardDetail.cardId}</code> mapped to
                this Spotify playlist in <code className="text-gray-300">data/state.json</code>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
              className={`w-11 h-6 rounded-full p-1 transition-colors shrink-0 ${
                autoSyncEnabled ? 'bg-spotify-green' : 'bg-gray-600'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full transition-transform ${
                  autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Status Feedback */}
          {syncError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded-xl p-3 text-xs flex items-start gap-2">
              <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <span>{syncError}</span>
            </div>
          )}

          {syncSuccessMessage && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-xl p-3 text-xs flex items-start gap-2">
              <CheckCircle size={15} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{syncSuccessMessage}</span>
            </div>
          )}

          {/* Primary Sync Button */}
          {!connected ? (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3 text-xs text-center">
              Connect both Spotify and Yoto in <strong>Config</strong> to run a live sync.
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSyncToThisCard}
              disabled={syncing || !selectedSpotifyPlaylist}
              className="w-full py-3.5 px-5 rounded-xl bg-yoto-orange hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg whitespace-nowrap"
            >
              <LinkIcon size={16} />
              <span>
                {syncing
                  ? `Syncing to ${cardDetail.title} (${cardDetail.cardId})...`
                  : selectedSpotifyPlaylist
                  ? `Sync "${selectedSpotifyPlaylist.name}" to ${cardDetail.title}`
                  : 'Select a Spotify Playlist to Sync'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
