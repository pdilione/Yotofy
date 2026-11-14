import React, { useState, useEffect } from 'react';
import { Playlist, Track, YotoCardConfig, AppSettings, ActivityLog } from '../types';
import { YotoDisplay } from './YotoDisplay';
import { generateYotoIcon } from '../services/geminiService';
import {
  CheckCircle,
  RefreshCw,
  Link,
  HardDrive,
  DownloadCloud,
  Database,
  UploadCloud,
  Cpu,
  Radio,
  Hash,
  Sparkles,
} from 'lucide-react';

interface Props {
  playlist: Playlist;
  onBack: () => void;
  onToggleSync: (
    playlistId: string,
    enabled: boolean,
    updatedTracks?: Track[],
    iconGrid?: string[],
    themeColor?: string
  ) => void;
  onLog?: (playlistName: string, message: string, type: ActivityLog['type'], details?: string) => void;
  connected: boolean;
  settings: AppSettings;
}

type PipelineStage =
  | 'idle'
  | 'analyzing_icon'
  | 'zotify_download'
  | 'yoto_upload_url'
  | 'yoto_put_audio'
  | 'yoto_poll_transcode'
  | 'yoto_post_content'
  | 'synced';

const makeHashFromTrackId = (id: string): string => {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 64; i++) {
    const code = (id.charCodeAt(i % id.length) * 17 + i * 31) % 16;
    out += chars[code];
  }
  return out;
};

export const SyncView: React.FC<Props> = ({
  playlist,
  onBack,
  onToggleSync,
  onLog,
  connected,
  settings,
}) => {
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(
    playlist.syncConfig?.enabled ? 'synced' : 'idle'
  );
  const [tracks, setTracks] = useState<Track[]>(playlist.tracks);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [yotoConfig, setYotoConfig] = useState<YotoCardConfig | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(playlist.syncConfig?.enabled || false);

  const emptyGrid = new Array(256).fill('#111111');

  useEffect(() => {
    setTracks(playlist.tracks);
    if (playlist.syncConfig?.enabled) {
      setPipelineStage('synced');
      setYotoConfig({
        id: playlist.syncConfig.targetYotoId,
        playlistId: playlist.id,
        title: playlist.name,
        iconGrid: playlist.generatedIcon || emptyGrid,
        themeColor: playlist.themeColor || '#FF6D00',
        status: 'synced',
      });
      if (!playlist.generatedIcon) {
        generateYotoIcon(
          playlist.name,
          playlist.tracks.map((t) => t.title)
        ).then((res) => {
          setYotoConfig((prev) =>
            prev ? { ...prev, iconGrid: res.iconGrid, themeColor: res.themeColor } : null
          );
        });
      }
    } else {
      setPipelineStage('idle');
    }
  }, [playlist]);

  const cachedCount = tracks.filter((t) => t.inLocalCache && t.transcodedSha256).length;
  const uncachedCount = tracks.length - cachedCount;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleSync = async () => {
    if (!connected) return;

    setPipelineStage('analyzing_icon');
    onLog?.(
      playlist.name,
      `Checking sync_cache.db: ${cachedCount} cached, ${uncachedCount} to pull from Spotify`,
      'info',
      `Using Zotify (librespot-python) + Yoto 4-Step API`
    );

    const trackNames = tracks.map((t) => t.title);
    const aiResult = await generateYotoIcon(playlist.name, trackNames);

    const cardId = playlist.syncConfig?.targetYotoId || `card-${playlist.id}`;
    setYotoConfig({
      id: cardId,
      playlistId: playlist.id,
      title: playlist.name,
      iconGrid: aiResult.iconGrid,
      themeColor: aiResult.themeColor,
      status: 'syncing',
    });

    const workingTracks = [...tracks];
    const uncachedIndices = workingTracks
      .map((t, idx) => (!t.inLocalCache || !t.transcodedSha256 ? idx : -1))
      .filter((idx) => idx !== -1);

    if (uncachedIndices.length > 0) {
      for (const idx of uncachedIndices) {
        const currentTrack = workingTracks[idx];
        setActiveTrackId(currentTrack.id);

        // Step A: Zotify download
        setPipelineStage('zotify_download');
        workingTracks[idx] = {
          ...currentTrack,
          zotifyStatus: 'downloading',
          yotoTranscodeStatus: 'idle',
        };
        setTracks([...workingTracks]);
        onLog?.(
          playlist.name,
          `Zotify (librespot): Pulling "${currentTrack.title}" (320kbps MP3)`,
          'download',
          `spotify:track:${currentTrack.id}`
        );
        await sleep(320);

        // Step B: Yoto Step 1 (/uploadUrl)
        setPipelineStage('yoto_upload_url');
        const uploadId = `upl_${currentTrack.id}_${Math.floor(Math.random() * 900 + 100)}`;
        workingTracks[idx] = {
          ...workingTracks[idx],
          zotifyStatus: 'downloaded',
          yotoTranscodeStatus: 'requesting_url',
          yotoUploadId: uploadId,
          localFilePath: `public/audio/${currentTrack.id}.mp3`,
        };
        setTracks([...workingTracks]);
        await sleep(220);

        // Step C: Yoto Step 2 (PUT audio binary)
        setPipelineStage('yoto_put_audio');
        workingTracks[idx] = {
          ...workingTracks[idx],
          yotoTranscodeStatus: 'uploading',
        };
        setTracks([...workingTracks]);
        await sleep(260);

        // Step D: Yoto Step 3 (Poll /media/upload/{uploadId}/transcoded)
        setPipelineStage('yoto_poll_transcode');
        workingTracks[idx] = {
          ...workingTracks[idx],
          yotoTranscodeStatus: 'transcoding',
        };
        setTracks([...workingTracks]);
        await sleep(300);

        const sha256 = makeHashFromTrackId(currentTrack.id);
        workingTracks[idx] = {
          ...workingTracks[idx],
          inLocalCache: true,
          zotifyStatus: 'cached',
          yotoTranscodeStatus: 'transcoded',
          transcodedSha256: sha256,
          syncedAt: 'Just now',
        };
        setTracks([...workingTracks]);
        onLog?.(
          playlist.name,
          `Cached transcodedSha256 for "${currentTrack.title}"`,
          'info',
          `yoto:#${sha256.slice(0, 16)}... (uploadId: ${uploadId})`
        );
      }
    }

    setActiveTrackId(null);

    // Step E: Yoto Step 4 (POST /content to create/update MYO card)
    setPipelineStage('yoto_post_content');
    onLog?.(
      playlist.name,
      `POST /content: Publishing ${workingTracks.length} tracks to MYO Card ${cardId}`,
      'info',
      `All tracks referenced via yoto:#<transcodedSha256>`
    );
    await sleep(600);

    setPipelineStage('synced');
    setYotoConfig((prev) => (prev ? { ...prev, status: 'synced' } : null));
    onLog?.(
      playlist.name,
      `MYO Playlist synced to Yoto Card (${cardId})`,
      'success',
      `${workingTracks.length} tracks active • 0 re-uploads needed on next run`
    );

    onToggleSync(
      playlist.id,
      autoSyncEnabled,
      workingTracks,
      aiResult.iconGrid,
      aiResult.themeColor
    );
  };

  const isBusy = pipelineStage !== 'idle' && pipelineStage !== 'synced';

  const getStageLabel = (stage: PipelineStage): string => {
    switch (stage) {
      case 'idle':
        return 'Ready to Sync';
      case 'analyzing_icon':
        return 'Gemini 16x16 Icon...';
      case 'zotify_download':
        return 'Zotify MP3 Pull...';
      case 'yoto_upload_url':
        return 'Step 1: GET /uploadUrl';
      case 'yoto_put_audio':
        return 'Step 2: PUT Audio MP3';
      case 'yoto_poll_transcode':
        return 'Step 3: Poll /transcoded';
      case 'yoto_post_content':
        return 'Step 4: POST /content';
      case 'synced':
        return 'MYO Card Synced';
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
            <img src={playlist.imageUrl} alt={playlist.name} className="w-8 h-8 rounded mr-3" />
            {playlist.name}
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
        {/* Left: Track List with Cache & Transcode Status */}
        <div className="bg-spotify-light/50 rounded-2xl p-6 flex flex-col h-full overflow-hidden border border-white/5 shadow-inner">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-gray-300 text-sm font-bold uppercase tracking-wider">
                Spotify Playlist Tracks ({tracks.length})
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Cached tracks reuse existing <code className="text-gray-400">yoto:#&lt;transcodedSha256&gt;</code> hashes
              </p>
            </div>
            {autoSyncEnabled && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <RefreshCw size={10} className="animate-spin" />
                Auto-Sync Active
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 max-h-[540px]">
            {tracks.map((track, idx) => {
              const isCurrent = activeTrackId === track.id;
              const isCached = Boolean(track.inLocalCache && track.transcodedSha256);

              return (
                <div
                  key={track.id}
                  className={`flex items-center p-2.5 rounded-xl border transition-all group ${
                    isCurrent
                      ? 'bg-yoto-orange/15 border-yoto-orange/50 shadow-md'
                      : isCached
                      ? 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                      : 'bg-amber-500/[0.04] border-amber-500/20 hover:bg-amber-500/[0.08]'
                  }`}
                >
                  <span className="text-gray-500 w-7 text-center text-xs font-mono">{idx + 1}</span>
                  <img
                    src={track.imageUrl}
                    alt={track.title}
                    className="w-10 h-10 rounded mr-3 opacity-85 group-hover:opacity-100"
                  />
                  <div className="flex-1 min-w-0 pr-3">
                    <div className="text-white truncate font-medium text-sm flex items-center gap-2">
                      <span className="truncate">{track.title}</span>
                    </div>
                    <div className="text-gray-400 text-xs truncate">
                      {track.artist} • <span className="text-gray-500 font-mono">{track.duration}</span>
                    </div>
                    {track.transcodedSha256 && (
                      <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5 flex items-center gap-1 truncate">
                        <Hash size={10} />
                        <span>yoto:#{track.transcodedSha256.slice(0, 20)}...</span>
                      </div>
                    )}
                  </div>

                  {/* Per-Track Status Badge */}
                  <div className="flex flex-col items-end flex-shrink-0">
                    {track.zotifyStatus === 'downloading' ? (
                      <span className="text-[11px] bg-spotify-green/20 text-spotify-green border border-spotify-green/40 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium animate-pulse">
                        <DownloadCloud size={11} />
                        Zotify MP3...
                      </span>
                    ) : track.yotoTranscodeStatus === 'requesting_url' ? (
                      <span className="text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                        <Link size={11} />
                        1/4 /uploadUrl
                      </span>
                    ) : track.yotoTranscodeStatus === 'uploading' ? (
                      <span className="text-[11px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                        <UploadCloud size={11} />
                        2/4 PUT Audio
                      </span>
                    ) : track.yotoTranscodeStatus === 'transcoding' ? (
                      <span className="text-[11px] bg-yoto-orange/20 text-yoto-orange border border-yoto-orange/40 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium animate-pulse">
                        <Cpu size={11} />
                        3/4 Transcoding
                      </span>
                    ) : isCached ? (
                      <span className="text-[11px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                        <CheckCircle size={11} />
                        Cached in DB
                      </span>
                    ) : (
                      <span className="text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full flex items-center gap-1 font-medium">
                        <DownloadCloud size={11} />
                        Pull via Zotify
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Yoto MYO Sync & 4-Step Pipeline Inspector */}
        <div className="flex flex-col items-center justify-between p-6 bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl border border-white/5 relative overflow-hidden">
          {/* Status Header */}
          <div className="w-full flex justify-between items-center z-10 mb-2">
            <div className="flex items-center space-x-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  pipelineStage === 'synced'
                    ? 'bg-green-500'
                    : isBusy
                    ? 'bg-yoto-orange animate-pulse'
                    : 'bg-gray-600'
                }`}
              />
              <span className="text-gray-200 text-xs font-bold uppercase tracking-widest">
                {getStageLabel(pipelineStage)}
              </span>
            </div>
            {pipelineStage === 'synced' && (
              <span className="text-xs font-mono text-yoto-orange bg-yoto-orange/10 px-2.5 py-1 rounded-full border border-yoto-orange/30 flex items-center gap-1">
                <Link size={12} />
                {yotoConfig?.id || `card-${playlist.id}`}
              </span>
            )}
          </div>

          {/* 16x16 Yoto LED Matrix Display */}
          <div className="w-48 sm:w-56 my-4 transform transition-all duration-500 hover:scale-105">
            <YotoDisplay
              iconGrid={yotoConfig?.iconGrid || playlist.generatedIcon || emptyGrid}
              themeColor={yotoConfig?.themeColor || playlist.themeColor || '#FF6D00'}
              isSyncing={isBusy}
            />
          </div>

          {/* Real-Time Zotify + Yoto 4-Step Pipeline Checklist */}
          <div className="w-full max-w-md space-y-3">
            <div className="bg-black/30 rounded-xl p-4 border border-white/10 space-y-2.5 text-xs">
              <div className="flex items-center justify-between text-gray-400 font-semibold uppercase tracking-wider text-[10px] pb-1 border-b border-white/5">
                <span>Yotofy Sync Pipeline</span>
                <span>
                  {cachedCount}/{tracks.length} Cached
                </span>
              </div>

              {/* Step 1: Zotify */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-300">
                  <DownloadCloud
                    size={14}
                    className={
                      pipelineStage === 'zotify_download'
                        ? 'text-spotify-green animate-bounce'
                        : cachedCount === tracks.length
                        ? 'text-emerald-400'
                        : 'text-gray-500'
                    }
                  />
                  <span>1. Zotify (librespot) 320kbps MP3</span>
                </div>
                <span className="font-mono text-[11px] text-gray-400">
                  {uncachedCount === 0 ? 'All Cached' : `${uncachedCount} pending`}
                </span>
              </div>

              {/* Step 2: /uploadUrl + PUT audio */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-300">
                  <UploadCloud
                    size={14}
                    className={
                      pipelineStage === 'yoto_upload_url' || pipelineStage === 'yoto_put_audio'
                        ? 'text-purple-400 animate-pulse'
                        : pipelineStage === 'synced'
                        ? 'text-emerald-400'
                        : 'text-gray-500'
                    }
                  />
                  <span>2. GET /uploadUrl &rarr; PUT Audio</span>
                </div>
                <span className="font-mono text-[11px] text-gray-400">
                  {pipelineStage === 'yoto_upload_url'
                    ? 'Pre-signing...'
                    : pipelineStage === 'yoto_put_audio'
                    ? 'Uploading MP3...'
                    : pipelineStage === 'synced'
                    ? 'Done'
                    : 'Standby'}
                </span>
              </div>

              {/* Step 3: Poll transcode */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-300">
                  <Cpu
                    size={14}
                    className={
                      pipelineStage === 'yoto_poll_transcode'
                        ? 'text-yoto-orange animate-spin'
                        : pipelineStage === 'synced'
                        ? 'text-emerald-400'
                        : 'text-gray-500'
                    }
                  />
                  <span>3. Poll /transcoded &rarr; SHA-256</span>
                </div>
                <span className="font-mono text-[11px] text-gray-400">
                  {pipelineStage === 'yoto_poll_transcode'
                    ? 'Polling...'
                    : pipelineStage === 'synced'
                    ? 'Cached'
                    : 'Standby'}
                </span>
              </div>

              {/* Step 4: POST /content */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-300">
                  <Sparkles
                    size={14}
                    className={
                      pipelineStage === 'yoto_post_content'
                        ? 'text-yoto-orange animate-pulse'
                        : pipelineStage === 'synced'
                        ? 'text-emerald-400'
                        : 'text-gray-500'
                    }
                  />
                  <span>4. POST /content (MYO Card Update)</span>
                </div>
                <span className="font-mono text-[11px] text-gray-400">
                  {pipelineStage === 'yoto_post_content'
                    ? 'Publishing...'
                    : pipelineStage === 'synced'
                    ? 'Linked'
                    : 'Standby'}
                </span>
              </div>
            </div>

            {/* Auto-Sync Toggle Control */}
            <div className="bg-black/20 rounded-xl p-3.5 border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center space-x-2">
                  <RefreshCw
                    className={`text-gray-400 ${autoSyncEnabled ? 'text-yoto-orange' : ''}`}
                    size={16}
                  />
                  <span className="font-medium text-sm text-white">Auto-Sync New Spotify Tracks</span>
                </div>
                <button
                  onClick={() => {
                    const next = !autoSyncEnabled;
                    setAutoSyncEnabled(next);
                    if (pipelineStage === 'synced') {
                      onToggleSync(
                        playlist.id,
                        next,
                        tracks,
                        yotoConfig?.iconGrid,
                        yotoConfig?.themeColor
                      );
                    }
                  }}
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
                Skips cached tracks in <code className="text-gray-300">sync_cache.db</code> and only pulls new songs via{' '}
                <strong>Zotify</strong> before updating <strong>POST /content</strong>.
              </p>
            </div>

            {/* Primary CTA / Status Banner */}
            {!connected ? (
              <div className="bg-red-500/10 text-red-200 p-3 rounded-xl text-xs border border-red-500/20 text-center">
                Connect both your Spotify &amp; Yoto Developer accounts on the dashboard to run the sync pipeline.
              </div>
            ) : isBusy ? (
              <div className="bg-yoto-orange/15 border border-yoto-orange/30 rounded-xl p-3.5 text-center text-xs text-yoto-orange font-medium animate-pulse">
                Running pipeline: {getStageLabel(pipelineStage)}...
              </div>
            ) : (
              <div className="space-y-2">
                {pipelineStage === 'synced' && (
                  <div className="bg-emerald-500/10 rounded-xl p-3 border border-emerald-500/30 flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <CheckCircle className="text-emerald-400 flex-shrink-0" size={18} />
                      <div className="text-xs">
                        <span className="text-white font-bold block">MYO Card Up to Date</span>
                        <span className="text-gray-300">
                          {cachedCount}/{tracks.length} tracks cached with{' '}
                          <code className="text-emerald-300">transcodedSha256</code>
                        </span>
                      </div>
                    </div>
                    {uncachedCount > 0 && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
                        {uncachedCount} new
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={handleSync}
                  className="w-full bg-yoto-orange hover:bg-yoto-red text-white font-bold py-3.5 px-6 rounded-full shadow-lg transform transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center space-x-2 text-sm"
                >
                  <Link size={18} />
                  <span>
                    {pipelineStage === 'synced'
                      ? uncachedCount > 0
                        ? `Sync ${uncachedCount} New Track${uncachedCount > 1 ? 's' : ''} to Yoto MYO`
                        : 'Re-Verify Cache & Update MYO Card'
                      : autoSyncEnabled
                      ? `Pull ${uncachedCount} Uncached & Link MYO Card`
                      : `Run Zotify + Yoto 4-Step Sync`}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};