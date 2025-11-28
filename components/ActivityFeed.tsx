import React from 'react';
import { ActivityLog } from '../types';
import { CheckCircle, Info, AlertCircle, DownloadCloud, Clock } from 'lucide-react';

interface Props {
  logs: ActivityLog[];
}

export const ActivityFeed: React.FC<Props> = ({ logs }) => {
  const getIcon = (type: ActivityLog['type']) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-green-400" />;
      case 'error': return <AlertCircle size={14} className="text-red-400" />;
      case 'download': return <DownloadCloud size={14} className="text-blue-400" />;
      case 'warning': return <AlertCircle size={14} className="text-yellow-400" />;
      default: return <Info size={14} className="text-gray-400" />;
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-gray-900 rounded-2xl p-6 border border-white/10 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center">
          <Clock size={16} className="mr-2" />
          Automation Log
        </h3>
        <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-gray-500">
          Realtime
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
        {logs.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-10">
            No activity recorded yet.
          </div>
        )}
        
        {logs.map((log, index) => (
          <div key={log.id} className="relative pl-6 animate-fade-in">
            {/* Timeline Line */}
            {index !== logs.length - 1 && (
              <div className="absolute left-[7px] top-5 bottom-[-24px] w-px bg-white/10" />
            )}
            
            {/* Dot Indicator */}
            <div className={`absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-gray-900 flex items-center justify-center ${
              log.type === 'success' ? 'bg-green-500' : 
              log.type === 'download' ? 'bg-blue-500' :
              log.type === 'error' ? 'bg-red-500' :
              'bg-gray-600'
            }`}>
            </div>

            <div className="flex flex-col">
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold text-gray-300 mb-0.5">
                  {log.playlistName}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">
                  {formatTime(log.timestamp)}
                </span>
              </div>
              <p className="text-sm text-gray-200 leading-snug">
                {log.message}
              </p>
              {log.details && (
                <p className="text-xs text-gray-500 mt-1 bg-black/20 p-2 rounded border border-white/5">
                  {log.details}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};