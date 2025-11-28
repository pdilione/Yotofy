import React, { useState, useEffect } from 'react';
import { Playlist, YotoCardConfig, AppSettings } from '../types';
import { YotoDisplay } from './YotoDisplay';
import { generateYotoIcon } from '../services/geminiService';
import { ArrowRight, CheckCircle, Smartphone, AlertCircle, RefreshCw, Link, Power, Globe, HardDrive } from 'lucide-react';

interface Props {
  playlist: Playlist;
  onBack: () => void;
  onToggleSync: (playlistId: string, enabled: boolean) => void;
  connected: boolean;
  settings: AppSettings;
}

export const SyncView: React.FC<Props> = ({ playlist, onBack, onToggleSync, connected, settings }) => {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'analyzing' | 'syncing' | 'synced'>('idle');
  const [yotoConfig, setYotoConfig] = useState<YotoCardConfig | null>(null);
  
  // State for the Auto-Sync Toggle
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(playlist.syncConfig?.enabled || false);
  
  // Initial empty grid
  const emptyGrid = new Array(256).fill('#111111');

  // If the playlist was already synced in mock data, set the state
  useEffect(() => {
    if (playlist.syncConfig?.enabled) {
      setSyncStatus('synced');
      // We would ideally fetch the existing card design here
      setYotoConfig({
        id: playlist.syncConfig.targetYotoId,
        playlistId: playlist.id,
        title: playlist.name,
        iconGrid: emptyGrid,
        themeColor: '#FF6D00',
        status: 'synced'
      });
      // Just to give it some visual pop on load
      generateYotoIcon(playlist.name, playlist.tracks.map(t => t.title)).then(res => {
        setYotoConfig(prev => prev ? { ...prev, iconGrid: res.iconGrid, themeColor: res.themeColor } : null);
      });
    }
  }, [playlist]);

  const handleSync = async () => {
    if (!connected) return;

    setSyncStatus('analyzing');
    
    // 1. Generate AI Content
    const trackNames = playlist.tracks.map(t => t.title);
    const aiResult = await generateYotoIcon(playlist.name, trackNames);

    const newConfig: YotoCardConfig = {
      id: `card-${playlist.id}`,
      playlistId: playlist.id,
      title: playlist.name,
      iconGrid: aiResult.iconGrid,
      themeColor: aiResult.themeColor,
      status: 'syncing'
    };

    setYotoConfig(newConfig);
    setSyncStatus('syncing');

    // 2. Simulate Sync Delay
    setTimeout(() => {
      setSyncStatus('synced');
      if (autoSyncEnabled) {
        onToggleSync(playlist.id, true);
      }
    }, 2500);
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center mb-6 justify-between">
        <div className="flex items-center">
          <button 
            onClick={onBack}
            className="text-gray-400 hover:text-white mr-4 transition-colors font-medium"
          >
            &larr; Back
          </button>
          <h2 className="text-2xl font-bold text-white flex items-center">
            <img src={playlist.imageUrl} className="w-8 h-8 rounded mr-3" />
            {playlist.name}
          </h2>
        </div>
        
        {/* Source Provider Badge */}
        <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 text-xs text-gray-400">
           <span>Audio Source:</span>
           <span className="text-white flex items-center font-medium">
             {settings.audioProvider === 'youtube_match' ? (
               <><Globe size={12} className="mr-1 text-red-400" /> YouTube Match</>
             ) : (
               <><HardDrive size={12} className="mr-1 text-blue-400" /> Local Library</>
             )}
           </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden">
        {/* Left: Track List */}
        <div className="bg-spotify-light/50 rounded-2xl p-6 flex flex-col h-full overflow-hidden border border-white/5 shadow-inner">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider">Source Tracks ({playlist.tracks.length})</h3>
             {autoSyncEnabled && (
               <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full flex items-center gap-1">
                 <RefreshCw size={10} className="animate-spin-slow" />
                 Watching for updates
               </span>
             )}
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
            {playlist.tracks.map((track, idx) => (
              <div key={track.id} className="flex items-center p-2 rounded-lg hover:bg-white/5 transition-colors group">
                <span className="text-gray-500 w-8 text-center">{idx + 1}</span>
                <img src={track.imageUrl} className="w-10 h-10 rounded mr-3 opacity-80 group-hover:opacity-100" />
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate font-medium">{track.title}</div>
                  <div className="text-gray-400 text-sm truncate">{track.artist}</div>
                </div>
                <div className="flex flex-col items-end">
                   <div className="text-gray-600 text-sm">{track.duration}</div>
                   {syncStatus === 'synced' && (
                     <div className="text-[10px] text-green-500/60 mt-1 flex items-center">
                        <CheckCircle size={10} className="mr-1"/> Matched
                     </div>
                   )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Yoto Sync Control */}
        <div className="flex flex-col items-center justify-center p-6 bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl border border-white/5 relative overflow-hidden">
          
          {/* Status Indicator */}
          <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-10">
            <div className="flex items-center space-x-2">
               <div className={`w-3 h-3 rounded-full ${syncStatus === 'synced' ? 'bg-green-500' : syncStatus === 'syncing' || syncStatus === 'analyzing' ? 'bg-yoto-orange animate-pulse' : 'bg-gray-600'}`} />
               <span className="text-gray-300 text-sm font-medium uppercase tracking-widest">
                 {syncStatus === 'idle' ? 'Ready to Sync' : syncStatus === 'analyzing' ? 'AI Designing...' : syncStatus === 'syncing' ? 'Linking...' : 'Active Link'}
               </span>
            </div>
            {syncStatus === 'synced' && <Link className="text-yoto-orange" size={20} />}
          </div>

          {/* The Player Display */}
          <div className="mb-8 mt-10 transform transition-all duration-500 hover:scale-105">
            <YotoDisplay 
              iconGrid={yotoConfig?.iconGrid || emptyGrid} 
              themeColor={yotoConfig?.themeColor || '#333'}
              isSyncing={syncStatus === 'syncing' || syncStatus === 'analyzing'}
            />
          </div>

          {/* Action Area */}
          <div className="w-full max-w-sm">
             {/* Auto-Sync Toggle Control */}
             <div className="bg-black/20 rounded-xl p-4 mb-4 border border-white/5 hover:border-white/10 transition-colors">
               <div className="flex items-center justify-between mb-2">
                 <div className="flex items-center space-x-2">
                    <RefreshCw className={`text-gray-400 ${autoSyncEnabled ? 'text-yoto-orange' : ''}`} size={18} />
                    <span className="font-medium text-white">Auto-Sync New Songs</span>
                 </div>
                 <button 
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${autoSyncEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                 >
                   <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${autoSyncEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                 </button>
               </div>
               <p className="text-xs text-gray-400 leading-relaxed">
                 Using <strong>{settings.audioProvider === 'youtube_match' ? 'YouTube' : 'Local Library'}</strong> to match new songs added to <strong>{playlist.name}</strong>.
               </p>
             </div>

             {syncStatus === 'idle' ? (
               <div className="text-center">
                 {!connected ? (
                   <div className="bg-red-500/10 text-red-200 p-3 rounded-lg text-sm border border-red-500/20">
                     Please connect your Spotify & Yoto accounts in the dashboard first.
                   </div>
                 ) : (
                    <button 
                      onClick={handleSync}
                      className="w-full bg-yoto-orange hover:bg-yoto-red text-white font-bold py-4 px-6 rounded-full shadow-lg transform transition-all hover:scale-105 active:scale-95 flex items-center justify-center space-x-2"
                    >
                      <Link size={20} />
                      <span>{autoSyncEnabled ? 'Link & Activate Sync' : 'Create One-Time Card'}</span>
                    </button>
                 )}
               </div>
             ) : syncStatus === 'synced' ? (
                <div className="bg-white/10 rounded-xl p-4 animate-fade-in border border-green-500/30">
                  <div className="flex items-start space-x-3">
                    <CheckCircle className="text-green-500 flex-shrink-0 mt-1" size={24} />
                    <div>
                      <h4 className="text-white font-bold text-lg">Playlist Linked!</h4>
                      <p className="text-gray-300 text-sm mt-1">
                        {autoSyncEnabled 
                          ? `We are watching for new tracks and will match them via ${settings.audioProvider === 'youtube_match' ? 'YouTube' : 'Local Files'}.` 
                          : "Tracks matched and copied successfully."}
                      </p>
                    </div>
                  </div>
                </div>
             ) : (
                <div className="text-center text-gray-400 animate-pulse">
                  <p>Establishing secure connection...</p>
                </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};