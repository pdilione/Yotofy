export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  imageUrl: string;
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
  syncConfig?: SyncConfig; // New field to track if this is auto-syncing
  generatedIcon?: string[]; // Cache the icon grid
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

export type AudioProvider = 'youtube_match' | 'local_library' | 'archived_source';
export type DeploymentMode = 'browser' | 'github_actions' | 'docker';

export interface AppSettings {
  audioProvider: AudioProvider;
  syncFrequency: 'realtime' | 'hourly' | 'daily';
  deploymentMode: DeploymentMode;
  autoConversion: boolean;
  notifications: boolean;
  githubUser: string;
  githubRepo: string;
}

export interface ActivityLog {
  id: string;
  timestamp: Date;
  playlistName: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'download';
  details?: string;
}