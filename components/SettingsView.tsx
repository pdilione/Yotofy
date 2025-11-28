import React from 'react';
import { AppSettings, AudioProvider, DeploymentMode } from '../types';
import { Save, Server, ShieldAlert, Zap, Globe, HardDrive, Info, Check, AlertTriangle, Key, Github, Box, Cloud, Copy, Rss, HelpCircle } from 'lucide-react';

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
}

export const SettingsView: React.FC<Props> = ({ settings, onSave, onBack }) => {
  const [localSettings, setLocalSettings] = React.useState<AppSettings>(settings);
  const [copied, setCopied] = React.useState(false);

  const handleProviderChange = (provider: AudioProvider) => {
    setLocalSettings({ ...localSettings, audioProvider: provider });
  };

  const handleFrequencyChange = (freq: 'realtime' | 'hourly' | 'daily') => {
    setLocalSettings({ ...localSettings, syncFrequency: freq });
  };

  const handleDeploymentChange = (mode: DeploymentMode) => {
    setLocalSettings({ ...localSettings, deploymentMode: mode });
  };

  const generateGithubYaml = () => {
    const cron = localSettings.syncFrequency === 'hourly' ? '0 * * * *' : '0 0 * * *';
    // Dynamically build the public URL based on user input
    const publicUrl = `https://${localSettings.githubUser || 'YOUR_USER'}.github.io/${localSettings.githubRepo || 'YOUR_REPO'}`;
    
    return `name: Yotofy Sync Engine

on:
  schedule:
    - cron: '${cron}'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  sync_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Install System Dependencies
        run: sudo apt-get install -y ffmpeg

      - name: Install Python Dependencies
        run: pip install -r backend/requirements.txt

      # Restore 'public/audio' from previous gh-pages branch deployment
      - name: Restore Audio Cache
        uses: actions/checkout@v3
        with:
          ref: gh-pages
          path: public_cache
        continue-on-error: true

      - name: Restore Audio Files
        run: |
          mkdir -p public/audio
          if [ -d "public_cache/audio" ]; then
            cp -r public_cache/audio/* public/audio/
          fi

      - name: Run Sync Engine
        run: python backend/sync.py
        env:
          SPOTIFY_CLIENT_ID: \${{ secrets.SPOTIFY_CLIENT_ID }}
          SPOTIFY_CLIENT_SECRET: \${{ secrets.SPOTIFY_CLIENT_SECRET }}
          SPOTIFY_PLAYLIST_ID: \${{ secrets.SPOTIFY_PLAYLIST_ID }}
          PUBLIC_URL: '${publicUrl}'

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./public
          keep_files: true # CRITICAL: Keeps MP3s safe
          user_name: 'github-actions[bot]'
          user_email: 'github-actions[bot]@users.noreply.github.com'
`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateGithubYaml());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in max-w-2xl mx-auto pb-10">
      <div className="flex items-center mb-8">
        <button 
          onClick={onBack}
          className="text-gray-400 hover:text-white mr-4 transition-colors font-medium"
        >
          &larr; Back
        </button>
        <h2 className="text-2xl font-bold text-white">System Configuration</h2>
      </div>

      <div className="space-y-8">
        
        {/* Architecture Notice */}
        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex items-start space-x-3">
          <Rss className="text-blue-400 flex-shrink-0" size={24} />
          <div>
            <h3 className="text-blue-400 font-bold text-sm uppercase tracking-wide">Yoto Podcast Strategy</h3>
            <p className="text-gray-300 text-sm mt-1 leading-relaxed">
              This backend generates a <strong>Private RSS Feed</strong> hosted on GitHub Pages. You only need to link your Yoto Card to this feed once.
            </p>
          </div>
        </div>

        {/* Audio Provider Section */}
        <div className="bg-gray-900 border border-white/5 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center">
            <Server className="mr-2 text-spotify-green" size={20} />
            Audio Source Strategy
          </h3>
          <p className="text-gray-400 text-sm mb-4">
            Choose where the backend should source the audio files.
          </p>
          
          <div className="space-y-3 mb-6">
            <div 
              onClick={() => handleProviderChange('youtube_match')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${localSettings.audioProvider === 'youtube_match' ? 'bg-spotify-green/10 border-spotify-green' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
            >
               <div className="flex items-center space-x-3">
                 <div className="p-2 bg-red-500/20 rounded-lg text-red-500"><Globe size={18} /></div>
                 <div>
                   <div className="text-white font-medium">YouTube Cross-Reference</div>
                   <div className="text-xs text-gray-500">Highest match rate. Downloads from official channels.</div>
                 </div>
               </div>
               {localSettings.audioProvider === 'youtube_match' && <div className="w-3 h-3 bg-spotify-green rounded-full shadow-lg shadow-green-500/50" />}
            </div>

            <div 
              onClick={() => handleProviderChange('local_library')}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${localSettings.audioProvider === 'local_library' ? 'bg-spotify-green/10 border-spotify-green' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}
            >
               <div className="flex items-center space-x-3">
                 <div className="p-2 bg-blue-500/20 rounded-lg text-blue-500"><HardDrive size={18} /></div>
                 <div>
                   <div className="text-white font-medium">Local Library Match</div>
                   <div className="text-xs text-gray-500">Uses your uploaded MP3s.</div>
                 </div>
               </div>
               {localSettings.audioProvider === 'local_library' && <div className="w-3 h-3 bg-spotify-green rounded-full shadow-lg shadow-green-500/50" />}
            </div>
          </div>
        </div>

        {/* Deployment Section */}
        <div className="bg-gray-900 border border-white/5 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center">
            <Cloud className="mr-2 text-blue-400" size={20} />
            Deployment Wizard
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
             <button 
               onClick={() => handleDeploymentChange('browser')}
               className={`p-3 rounded-lg border text-left transition-all ${localSettings.deploymentMode === 'browser' ? 'bg-blue-500/20 border-blue-500 text-white' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'}`}
             >
               <Globe size={18} className="mb-2" />
               <div className="font-bold text-sm">Browser Demo</div>
               <div className="text-[10px] opacity-70">Frontend Only</div>
             </button>

             <button 
               onClick={() => handleDeploymentChange('github_actions')}
               className={`p-3 rounded-lg border text-left transition-all ${localSettings.deploymentMode === 'github_actions' ? 'bg-blue-500/20 border-blue-500 text-white' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'}`}
             >
               <Github size={18} className="mb-2" />
               <div className="font-bold text-sm">GitHub Actions</div>
               <div className="text-[10px] opacity-70">Complete Backend</div>
             </button>
          </div>

          {localSettings.deploymentMode === 'github_actions' && (
            <div className="space-y-6 animate-fade-in">
              
              {/* Step 1: Repo Info */}
              <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center">
                  <span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs mr-2">1</span>
                  Repository Details
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">GitHub Username</label>
                    <input 
                      type="text" 
                      value={localSettings.githubUser}
                      onChange={(e) => setLocalSettings({...localSettings, githubUser: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-spotify-green focus:outline-none transition-colors"
                      placeholder="e.g. jdoe"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Repo Name</label>
                    <input 
                      type="text" 
                      value={localSettings.githubRepo}
                      onChange={(e) => setLocalSettings({...localSettings, githubRepo: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:border-spotify-green focus:outline-none transition-colors"
                      placeholder="e.g. yotofy"
                    />
                  </div>
                </div>
              </div>

              {/* Step 2: Secrets */}
              <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center">
                  <span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs mr-2">2</span>
                  Add Secrets to GitHub
                </h4>
                <p className="text-xs text-gray-400 mb-3">
                  Go to <strong className="text-white">Settings &gt; Secrets and variables &gt; Actions</strong> in your repo and add these keys:
                </p>
                
                <div className="space-y-2">
                   <div className="flex items-center justify-between bg-white/5 p-2 rounded text-xs">
                      <code className="text-red-300 font-mono">SPOTIFY_CLIENT_ID</code>
                      <a href="https://developer.spotify.com/dashboard" target="_blank" className="text-[10px] text-gray-500 underline hover:text-white">Get from Spotify Dev Dashboard</a>
                   </div>
                   <div className="flex items-center justify-between bg-white/5 p-2 rounded text-xs">
                      <code className="text-red-300 font-mono">SPOTIFY_CLIENT_SECRET</code>
                      <span className="text-[10px] text-gray-500">From Spotify Dev Dashboard</span>
                   </div>
                   <div className="flex items-center justify-between bg-white/5 p-2 rounded text-xs">
                      <code className="text-red-300 font-mono">SPOTIFY_PLAYLIST_ID</code>
                      <span className="text-[10px] text-gray-500">Copy from Playlist Share Link</span>
                   </div>
                </div>
              </div>

              {/* Step 3: YAML */}
              <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                <div className="flex justify-between items-center mb-3">
                   <h4 className="text-sm font-bold text-gray-300 flex items-center">
                     <span className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-xs mr-2">3</span>
                     Workflow File
                   </h4>
                   <button 
                     onClick={copyToClipboard} 
                     className="text-xs flex items-center bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition-colors"
                   >
                     {copied ? <Check size={12} className="mr-1"/> : <Copy size={12} className="mr-1"/>}
                     {copied ? 'Copied' : 'Copy'}
                   </button>
                </div>
                
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3">
                   <p className="text-xs text-amber-300 font-bold mb-1">Action Required:</p>
                   <p className="text-[10px] text-amber-200">
                      1. Create file <code>.github/workflows/yotofy.yml</code><br/>
                      2. Paste the code below.<br/>
                      3. <strong>IMPORTANT:</strong> Rename <code>backend/sync_script.txt</code> to <code>backend/sync.py</code>.
                   </p>
                </div>

                <div className="bg-black/80 p-3 rounded-lg border border-white/10 relative overflow-hidden group">
                  <pre className="text-[10px] text-green-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-60 custom-scrollbar">
                    {generateGithubYaml()}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={() => onSave(localSettings)}
          className="w-full bg-white text-black font-bold py-4 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center space-x-2"
        >
          <Save size={18} />
          <span>Save Configuration</span>
        </button>

      </div>
    </div>
  );
};