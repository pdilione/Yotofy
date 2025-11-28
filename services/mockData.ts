import { Playlist, Track, ActivityLog } from '../types';

const generateTracks = (count: number, prefix: string): Track[] => {
  return Array.from({ length: count }).map((_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} Song ${i + 1}`,
    artist: `Artist ${String.fromCharCode(65 + (i % 5))}`,
    album: `The ${prefix} Album`,
    duration: `${2 + (i % 3)}:${10 + (i * 5) % 50}`,
    imageUrl: `https://picsum.photos/seed/${prefix}${i}/64/64`
  }));
};

// Mock Icon Grids
const emptyGrid = new Array(256).fill('#000000');
const createSimpleIcon = (color: string) => {
  const grid = [...emptyGrid];
  // Simple pattern
  for(let i = 60; i < 200; i+=16) {
     grid[i] = color;
     grid[i+15] = color;
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
    tracks: generateTracks(12, 'Morning'),
    syncConfig: {
      enabled: true,
      lastCheck: '10 mins ago',
      targetYotoId: 'card-123'
    },
    generatedIcon: createSimpleIcon('#FF6D00'),
    themeColor: '#FF6D00'
  },
  {
    id: 'pl-2',
    name: 'Toddler Dance Party',
    description: 'High energy hits for the little ones.',
    trackCount: 25,
    imageUrl: 'https://picsum.photos/seed/dance/300/300',
    tracks: generateTracks(25, 'Dance')
  },
  {
    id: 'pl-3',
    name: 'Bedtime Stories',
    description: 'Calm tracks and stories for sleep.',
    trackCount: 8,
    imageUrl: 'https://picsum.photos/seed/sleep/300/300',
    tracks: generateTracks(8, 'Sleep')
  },
  {
    id: 'pl-4',
    name: 'Road Trip Singalong',
    description: 'Classics for the long drive.',
    trackCount: 40,
    imageUrl: 'https://picsum.photos/seed/road/300/300',
    tracks: generateTracks(40, 'Trip')
  }
];

export const MOCK_LOGS: ActivityLog[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5), // 5 mins ago
    playlistName: 'Morning Coffee',
    message: 'Scheduled sync check completed',
    type: 'info',
    details: 'No new tracks found.'
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 1000 * 60 * 65), // 1 hour 5 mins ago
    playlistName: 'Toddler Dance Party',
    message: 'Manual sync initiated',
    type: 'info'
  },
  {
    id: 'log-3',
    timestamp: new Date(Date.now() - 1000 * 60 * 66), // 1 hour 6 mins ago
    playlistName: 'Toddler Dance Party',
    message: 'Found 3 new tracks on Spotify',
    type: 'download',
    details: 'Matching via YouTube...'
  },
  {
    id: 'log-4',
    timestamp: new Date(Date.now() - 1000 * 60 * 67), // 1 hour 7 mins ago
    playlistName: 'Toddler Dance Party',
    message: 'Successfully updated Yoto Card',
    type: 'success',
    details: 'Card ID: card-pl-2'
  }
];