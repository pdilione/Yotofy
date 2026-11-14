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

export type ScreenState = 'dashboard' | 'detail' | 'settings';

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
}

export interface ConnectedUserProfile {
  id?: string;
  display_name: string;
  avatar?: string | null;
  email?: string;
}

export interface ActivityLog {
  id: string;
  timestamp: Date;
  playlistName: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'download';
  details?: string;
}