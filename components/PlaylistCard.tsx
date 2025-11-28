import React from 'react';
import { Playlist } from '../types';
import { Music, RefreshCw } from 'lucide-react';

interface Props {
  playlist: Playlist;
  onClick: (playlist: Playlist) => void;
}

export const PlaylistCard: React.FC<Props> = ({ playlist, onClick }) => {
  return (
    <div 
      onClick={() => onClick(playlist)}
      className={`bg-white/5 p-4 rounded-xl hover:bg-white/10 transition-all cursor-pointer group border ${playlist.syncConfig?.enabled ? 'border-yoto-orange/50' : 'border-transparent'} hover:border-spotify-green/30 relative overflow-hidden`}
    >
      {playlist.syncConfig?.enabled && (
        <div className="absolute top-0 right-0 bg-yoto-orange text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg z-10 flex items-center gap-1">
          <RefreshCw size={10} className="animate-spin-slow" />
          AUTO-SYNC
        </div>
      )}
      
      <div className="relative aspect-square mb-4 overflow-hidden rounded-md shadow-lg">
        <img 
          src={playlist.imageUrl} 
          alt={playlist.name} 
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" 
        />
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
        <div className="absolute bottom-2 right-2 bg-spotify-green text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all">
          <Music size={20} />
        </div>
      </div>
      <h3 className="font-bold text-white truncate text-lg">{playlist.name}</h3>
      <p className="text-gray-400 text-sm truncate mb-2">{playlist.description}</p>
      
      <div className="flex items-center justify-between mt-3">
        <span className="inline-block bg-white/10 text-xs text-gray-300 px-2 py-1 rounded-full">
          {playlist.trackCount} Tracks
        </span>
        {playlist.syncConfig && (
          <span className="text-[10px] text-gray-500">
            Checked: {playlist.syncConfig.lastCheck}
          </span>
        )}
      </div>
    </div>
  );
};