import { Playlist, Track, ActivityLog } from '../types';

const makeSha256 = (seed: string): string => {
  let hash = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < 64; i++) {
    const code = (seed.charCodeAt(i % seed.length) * (i + 7) + i * 13) % 16;
    hash += chars[code];
  }
  return hash;
};

const generateTracks = (count: number, prefix: string, allCached = false): Track[] => {
  return Array.from({ length: count }).map((_, i) => {
    // Make some tracks already cached in local sync_cache.db, while others need to be pulled from Spotify
    const isCached = allCached || i % 3 === 0;
    const sha = isCached ? makeSha256(`${prefix}-track-${i}`) : undefined;

    return {
      id: `${prefix.toLowerCase()}-${i + 1}`,
      title: `${prefix} Song ${i + 1}`,
      artist: `Artist ${String.fromCharCode(65 + (i % 5))}`,
      album: `The ${prefix} Album`,
      duration: `${2 + (i % 3)}:${String(10 + ((i * 5) % 50)).padStart(2, '0')}`,
      imageUrl: `https://picsum.photos/seed/${prefix}${i}/64/64`,
      inLocalCache: isCached,
      zotifyStatus: isCached ? 'cached' : 'pending',
      yotoTranscodeStatus: isCached ? 'transcoded' : 'idle',
      transcodedSha256: sha,
      localFilePath: isCached ? `public/audio/${prefix.toLowerCase()}-${i + 1}.mp3` : undefined,
      fileSize: isCached ? 4200000 + i * 150000 : undefined,
    };
  });
};

// Mock Icon Grids
const emptyGrid = new Array(256).fill('#000000');
const createSimpleIcon = (color: string) => {
  const grid = [...emptyGrid];
  for (let i = 60; i < 200; i += 16) {
    grid[i] = color;
    grid[i + 15] = color;
  }
  return grid;
};

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-1',
    name: 'Morning Coffee',
    description: 'Chill vibes to start the day right.',
    trackCount: 12,
    imageUrl: 'https://picsum.photos/seed/coffee/300/300',
    tracks: generateTracks(12, 'Morning', true),
    syncConfig: {
      enabled: true,
      lastCheck: '10 mins ago',
      targetYotoId: 'card-73shQ'
    },
    generatedIcon: createSimpleIcon('#FF6D00'),
    themeColor: '#FF6D00'
  },
  {
    id: 'pl-2',
    name: 'Toddler Dance Party',
    description: 'High energy hits for the little ones.',
    trackCount: 10,
    imageUrl: 'https://picsum.photos/seed/dance/300/300',
    tracks: generateTracks(10, 'Dance', false)
  },
  {
    id: 'pl-3',
    name: 'Bedtime Stories',
    description: 'Calm tracks and stories for sleep.',
    trackCount: 8,
    imageUrl: 'https://picsum.photos/seed/sleep/300/300',
    tracks: generateTracks(8, 'Sleep', false)
  },
  {
    id: 'pl-4',
    name: 'Road Trip Singalong',
    description: 'Classics for the long drive.',
    trackCount: 15,
    imageUrl: 'https://picsum.photos/seed/road/300/300',
    tracks: generateTracks(15, 'Trip', false)
  }
];

export const MOCK_LOGS: ActivityLog[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    playlistName: 'Morning Coffee',
    message: 'Cache check completed (12/12 tracks in sync_cache.db)',
    type: 'info',
    details: '0 new tracks to pull from Spotify.'
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 1000 * 60 * 64),
    playlistName: 'Morning Coffee',
    message: 'POST /content updated MYO playlist',
    type: 'success',
    details: 'Card ID: card-73shQ • 12 yoto:#<sha256> tracks linked'
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 1000 * 60 * 65),
    playlistName: 'Morning Coffee',
    message: 'Yoto transcode complete for 2 new tracks',
    type: 'info',
    details: 'transcodedSha256 saved to local SQLite/JSON cache'
  },
  {
    id: 'log-4',
    timestamp: new Date(Date.now() - 1000 * 60 * 66),
    playlistName: 'Morning Coffee',
    message: 'Zotify (librespot) downloaded 2 tracks (320kbps MP3)',
    type: 'download',
    details: 'Uploaded via PUT /media/transcode/audio/uploadUrl'
  }
];