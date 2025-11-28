import React, { useState, useEffect } from 'react';
import { MOCK_PLAYLISTS, MOCK_LOGS } from './services/mockData';
import { Playlist, ScreenState, AppSettings, ActivityLog } from './types';
import { PlaylistCard } from './components/PlaylistCard';
import { SyncView } from './components/SyncView';
import { SettingsView } from './components/SettingsView';
import { ActivityFeed } from './components/ActivityFeed';
import { YotoDisplay } from './components/YotoDisplay';
import { Radio, Settings, Play, LayoutGrid, ListMusic } from 'lucide-react';

const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('dashboard');
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>(MOCK_PLAYLISTS);
  const [logs, setLogs] = useState<ActivityLog[]>(MOCK_LOGS);
  const [dashboardView, setDashboardView] = useState<'spotify' | 'yoto'>('spotify');

  // App Level Settings
  const [settings, setSettings] = useState<AppSettings>({
    audioProvider: 'youtube_match',
    syncFrequency: 'hourly',
    deploymentMode: 'browser',
    autoConversion: true,
    notifications: true,
    githubUser: 'your-username',
    githubRepo: 'yotofy'
  });

  // Connection Simulation State
  const [connections, setConnections] = useState({
    spotify: true, 
    yoto: false
  });

  const handlePlaylistSelect = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setCurrentScreen('detail');
  };

  const handleBack = () => {
    setSelectedPlaylist(null);
    setCurrentScreen('dashboard');
  };

  const handleToggleSync = (playlistId: string, enabled: boolean) => {
    const updated = playlists.map(p => {
      if (p.id === playlistId) {
        return {
          ...p,
          syncConfig: enabled ? {
            enabled: true,
            lastCheck: 'Just now',
            targetYotoId: `card-${playlistId}`
          } : undefined
        };
      }
      return p;
    });
    setPlaylists(updated);
    
    // Add log
    if (enabled) {
      addLog(playlists.find(p => p.id === playlistId)?.name || 'Playlist', 'Auto-Sync enabled', 'success');
    }
  };

  const toggleConnection = (service: 'spotify' | 'yoto') => {
    setConnections(prev => ({ ...prev, [service]: !prev[service] }));
    addLog('System', `${service === 'spotify' ? 'Spotify' : 'Yoto'} ${!connections[service] ? 'connected' : 'disconnected'}`, 'info');
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    setCurrentScreen('dashboard');
    addLog('System', 'Configuration updated', 'info');
  };

  // Helper to add logs
  const addLog = (playlistName: string, message: string, type: ActivityLog['type'], details?: string) => {
    const newLog: ActivityLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      playlistName,
      message,
      type,
      details
    };
    setLogs(prev => [newLog, ...prev]);
  };

  // Simulation Logic
  const simulateSpotifyUpdate = () => {
    if (!connections.spotify) {
      alert("Connect Spotify first!");
      return;
    }

    const syncedPlaylists = playlists.filter(p => p.syncConfig?.enabled);
    if (syncedPlaylists.length === 0) {
      alert("Enable Auto-Sync on at least one playlist first.");
      return;
    }

    // Pick a random playlist
    const target = syncedPlaylists[Math.floor(Math.random() * syncedPlaylists.length)];
    const newSongTitle = `Simulated Track ${Math.floor(Math.random() * 100)}`;

    addLog(target.name, `Spotify Webhook: New track detected`, 'info', `Track: ${newSongTitle}`);

    setTimeout(() => {
      addLog(target.name, `Searching ${settings.audioProvider === 'youtube_match' ? 'YouTube' : 'Local'} for audio`, 'download');
      
      setTimeout(() => {
        addLog(target.name, `Track matched and uploaded to Yoto`, 'success', `Added "${newSongTitle}" to Card ${target.syncConfig?.targetYotoId}`);
        
        // Update playlist track count visually
        setPlaylists(prev => prev.map(p => {
          if (p.id === target.id) {
            return { ...p, trackCount: p.trackCount + 1 };
          }
          return p;
        }));
      }, 1500);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-spotify-black text-white flex flex-col font-sans selection:bg-yoto-orange selection:text-white">
      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-spotify-black z-50 sticky top-0 backdrop-blur-md bg-opacity-90">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={handleBack}>
           <div className="bg-gradient-to-br from-spotify-green to-teal-500 p-2 rounded-lg">
             <Radio className="text-white" size={20} />
           </div>
           <h1 className="text-xl font-bold tracking-tight">Yotofy</h1>
        </div>
        
        <div className="flex items-center space-x-6 text-sm font-medium text-gray-400">
           {/* Simulation Button */}
           <button 
             onClick={simulateSpotifyUpdate}
             className="hidden md:flex items-center space-x-2 bg-white/5 hover:bg-white/10 text-spotify-green px-3 py-1.5 rounded-full border border-spotify-green/20 transition-all hover:border-spotify-green/50"
           >
             <Play size={14} className="fill-current" />
             <span>Simulate Spotify Update</span>
           </button>

          <div className="w-px h-4 bg-gray-700 hidden md:block"></div>

          <button 
            onClick={() => setCurrentScreen('settings')}
            className={`flex items-center space-x-1 hover:text-white transition-colors ${currentScreen === 'settings' ? 'text-white' : ''}`}
          >
            <Settings size={16} />
            <span>Config</span>
          </button>
          
          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold text-white cursor-pointer hover:ring-2 ring-white/20">
            JD
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {currentScreen === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in-up">
            
            {/* Left Column: Main Dashboard */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Welcome/Status Widget */}
              <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-spotify-green/20 to-yoto-orange/20 p-8 border border-white/5">
                <div className="relative z-10">
                  <h2 className="text-3xl font-extrabold mb-2">System Active.</h2>
                  <p className="text-gray-300 text-lg mb-4 max-w-lg">
                    Monitoring <strong>{playlists.filter(p => p.syncConfig?.enabled).length} playlists</strong> for changes. New tracks will be auto-matched and synced.
                  </p>
                  <div className="flex items-center space-x-4">
                     <div className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border ${connections.spotify ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${connections.spotify ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span>Spotify API</span>
                     </div>
                     <div className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border ${connections.yoto ? 'bg-yoto-orange/10 border-yoto-orange/30 text-yoto-orange' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${connections.yoto ? 'bg-yoto-orange' : 'bg-red-500'}`} />
                        <span>Yoto Cloud</span>
                     </div>
                  </div>
                </div>
              </div>

              {/* Toggle View */}
              <div className="flex items-center justify-between">
                <div className="flex space-x-4">
                  <button 
                    onClick={() => setDashboardView('spotify')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${dashboardView === 'spotify' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <ListMusic size={16} />
                    <span>Spotify Sources</span>
                  </button>
                  <button 
                    onClick={() => setDashboardView('yoto')}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${dashboardView === 'yoto' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
                  >
                    <LayoutGrid size={16} />
                    <span>My Yoto Cards</span>
                  </button>
                </div>
              </div>
              
              {/* Grid Content */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {dashboardView === 'spotify' ? (
                  <>
                    {playlists.map(playlist => (
                      <PlaylistCard 
                        key={playlist.id} 
                        playlist={playlist} 
                        onClick={handlePlaylistSelect} 
                      />
                    ))}
                    <div className="border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center p-6 text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-all cursor-pointer min-h-[250px] group">
                      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <span className="text-2xl">+</span>
                      </div>
                      <span className="font-medium">Add Source</span>
                    </div>
                  </>
                ) : (
                  <>
                     {playlists.filter(p => p.syncConfig?.enabled).map(playlist => (
                       <div key={playlist.id} onClick={() => handlePlaylistSelect(playlist)} className="cursor-pointer group">
                          <div className="bg-gray-800 rounded-2xl p-4 border border-white/5 hover:border-yoto-orange/50 transition-all hover:-translate-y-1 shadow-lg">
                            <div className="aspect-square mb-4">
                               <YotoDisplay 
                                 iconGrid={playlist.generatedIcon || new Array(256).fill('#000')} 
                                 themeColor={playlist.themeColor || '#333'} 
                                 isSyncing={false} 
                               />
                            </div>
                            <h3 className="text-center font-bold text-white text-sm truncate">{playlist.name}</h3>
                            <div className="flex justify-center mt-2">
                               <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                 Active Sync
                               </span>
                            </div>
                          </div>
                       </div>
                     ))}
                     {playlists.filter(p => p.syncConfig?.enabled).length === 0 && (
                       <div className="col-span-full py-12 text-center text-gray-500">
                         <p>No synced cards yet. Go to "Spotify Sources" and enable sync on a playlist.</p>
                       </div>
                     )}
                  </>
                )}
              </div>
            </div>

            {/* Right Column: Sidebar */}
            <div className="space-y-6">
               {/* Quick Connect Panel */}
               <div className="bg-gray-900 rounded-2xl p-6 border border-white/10">
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Services</h3>
                 </div>
                 <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                       <span className="font-medium text-sm">Spotify</span>
                       <button onClick={() => toggleConnection('spotify')} className={`text-xs ${connections.spotify ? 'text-green-400' : 'text-gray-500'}`}>
                         {connections.spotify ? 'Connected' : 'Disconnected'}
                       </button>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                       <span className="font-medium text-sm">Yoto Account</span>
                       <button onClick={() => toggleConnection('yoto')} className={`text-xs ${connections.yoto ? 'text-yoto-orange' : 'text-gray-500'}`}>
                         {connections.yoto ? 'Connected' : 'Disconnected'}
                       </button>
                    </div>
                 </div>
               </div>

               {/* Activity Feed */}
               <div className="h-[500px]">
                 <ActivityFeed logs={logs} />
               </div>
            </div>
          </div>
        )}

        {currentScreen === 'detail' && selectedPlaylist && (
          <SyncView 
            playlist={selectedPlaylist} 
            onBack={handleBack}
            onToggleSync={handleToggleSync}
            connected={connections.yoto && connections.spotify}
            settings={settings}
          />
        )}

        {currentScreen === 'settings' && (
          <SettingsView 
            settings={settings}
            onSave={handleSaveSettings}
            onBack={handleBack}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 mt-8 bg-black/20">
         <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-xs">
           <p className="mb-2">Yotofy Personal Automation Tool.</p>
         </div>
      </footer>
    </div>
  );
};

export default App;