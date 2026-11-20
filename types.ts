export type ZotifyDownloadStatus =
  | 'idle'
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'cached'
  | 'failed';

export type YotoTranscodeStatus =
  | 'idle'
  | 'requesting_url'
  | 'uploading'
  | 'transcoding'
  | 'transcoded'
  | 'failed';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  imageUrl: string;
  /** Whether the track already exists in the local library / sync_cache */
  inLocalCache?: boolean;
  /** Current Zotify (librespot-python) MP3 download status */
  zotifyStatus?: ZotifyDownloadStatus;
  /** Yoto Developer API transcoded audio SHA-256 hash (used as yoto:#<transcodedSha256>) */
  transcodedSha256?: string;
  /** Yoto 4-step upload & transcode pipeline status */
  yotoTranscodeStatus?: YotoTranscodeStatus;
  /** Temporary Yoto uploadId returned by /media/transcode/audio/uploadUrl */
  yotoUploadId?: string;
  /** Path to the locally cached MP3 file */
  localFilePath?: string;
  /** File size in bytes */
  fileSize?: number;
  /** Audio codec format returned by Yoto transcodedInfo (e.g. aac or mp3) */
  format?: string;
  /** Audio channel configuration returned by Yoto transcodedInfo (e.g. stereo or mono) */
  channels?: string;
  /** Yoto 16x16 custom display icon mediaId generated from real album art */
  iconMediaId?: string;
  /** Full Yoto icon URI (yoto:#<mediaId>) */
  icon16x16?: string;
  /** Timestamp when the track was last synced to Yoto */
  syncedAt?: string;
}

export interface TrackCacheEntry {
  spotifyTrackId: string;
  transcodedSha256: string;
  title?: string;
  artist?: string;
  duration?: number;
  fileSize?: number;
  format?: string;
  channels?: string;
  iconMediaId?: string;
  imageUrl?: string;
  syncedAt?: number;
}

export interface SyncConfig {
  enabled: boolean;
  lastCheck: string;
  targetYotoId: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  imageUrl: string;
  tracks: Track[];
  syncConfig?: SyncConfig; // Tracks auto-sync configuration and target Yoto MYO card ID
  generatedIcon?: string[]; // Cache the 16x16 pixel art icon grid
  themeColor?: string;
}

export interface YotoCardConfig {
  id: string;
  playlistId: string;
  title: string;
  iconGrid: string[]; // Array of hex codes for 16x16 grid
  themeColor: string;
  status: 'idle' | 'syncing' | 'synced' | 'error';
  lastSynced?: Date;
}

export interface YotoCardTrackItem {
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
  iconMediaId?: string;
  icon16x16?: string;
  imageUrl?: string;
}

export interface YotoCardChapterItem {
  key: string;
  title: string;
  overlayLabel?: string;
  icon16x16?: string;
  duration?: number;
  fileSize?: number;
  tracks: YotoCardTrackItem[];
}

export interface YotoMyoCard {
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

export type ScreenState = 'dashboard' | 'detail' | 'yoto_detail' | 'settings' | 'logs';

export type AudioProvider =
  | 'zotify'
  | 'local_library'
  | 'archived_source'
  | 'youtube_match';

export type DeploymentMode = 'browser' | 'github_actions' | 'docker';

export interface AppSettings {
  audioProvider: AudioProvider;
  syncFrequency: 'realtime' | 'hourly' | 'daily';
  deploymentMode: DeploymentMode;
  autoConversion: boolean;
  notifications: boolean;
  githubUser: string;
  githubRepo: string;
  yotoCardId?: string;
  spotifyClientId?: string;
  yotoClientId?: string;
}

export interface ConnectedUserProfile {
  id?: string;
  display_name: string;
  avatar?: string | null;
  email?: string;
  cardCount?: number;
}

export interface ActivityLog {
  id: string;
  timestamp: Date;
  playlistName: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'download';
  details?: string;
}

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  logger: string;
  message: string;
  details?: string;
}

export interface SystemDiagnostics {
  credentialsPath: string;
  credentialsExists: boolean;
  credentialsSize: number;
  credentialsValid?: boolean;
  credentialsUsername?: string;
  credentialsError?: string;
  dataDir: string;
  audioDir: string;
  logFilePath: string;
  ffmpegAvailable?: boolean;
  zotifyAvailable?: boolean;
}

export interface ZotifyCredentialsStatus {
  exists: boolean;
  valid: boolean;
  username?: string;
  type?: string;
  path: string;
  size: number;
  error?: string;
}