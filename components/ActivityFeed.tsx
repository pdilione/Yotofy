import React, { useEffect, useState } from 'react';
import { ActivityLog } from '../types';
import { getActivity } from '../services/api';
import {
  CheckCircle,
  Info,
  AlertCircle,
  DownloadCloud,
  Clock,
  RefreshCw,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface Props {
  logs?: ActivityLog[];
  onLogsLoaded?: (logs: ActivityLog[]) => void;
  onOpenLogs?: () => void;
}

export const ActivityFeed: React.FC<Props> = ({ logs, onLogsLoaded, onOpenLogs }) => {
  const [internalLogs, setInternalLogs] = useState<ActivityLog[]>(logs || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (logs !== undefined) {
      setInternalLogs(logs);
    }
  }, [logs]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getActivity()
      .then((fetched) => {
        if (!mounted) return;
        setInternalLogs(fetched);
        onLogsLoaded?.(fetched);
      })
      .catch(() => {
        if (!mounted) return;
        if (logs === undefined) {
          setInternalLogs([]);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1500);
  };

  const getIcon = (type: ActivityLog['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={14} className="text-green-400 shrink-0" />;
      case 'error':
        return <AlertCircle size={14} className="text-red-400 shrink-0" />;
      case 'download':
        return <DownloadCloud size={14} className="text-blue-400 shrink-0" />;
      case 'warning':
        return <AlertCircle size={14} className="text-yellow-400 shrink-0" />;
      default:
        return <Info size={14} className="text-gray-400 shrink-0" />;
    }
  };

  const formatTime = (date: Date | string) => {
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="bg-gray-900 rounded-2xl p-6 border border-white/10 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-6">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center">
          <Clock size={16} className="mr-2" />
          Automation Log
        </h3>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw size={12} className="animate-spin text-gray-500" />}
          {onOpenLogs && (
            <button
              type="button"
              onClick={onOpenLogs}
              className="text-xs bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 text-gray-200 flex items-center gap-1.5 transition-colors font-medium"
            >
              <Terminal size={12} className="text-spotify-green" />
              <span>System Logs</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-5 pr-2">
        {internalLogs.length === 0 && (
          <div className="text-center text-gray-500 text-xs py-12">
            No recent activity
          </div>
        )}

        {internalLogs.map((log, index) => {
          const hasMultilineDetails = Boolean(
            log.details && (log.details.includes('\n') || log.details.length > 120)
          );
          const isExpanded = expandedIds[log.id] ?? log.type === 'error';

          return (
            <div key={log.id} className="relative pl-6 animate-fade-in">
              {index !== internalLogs.length - 1 && (
                <div className="absolute left-[7px] top-5 bottom-[-20px] w-px bg-white/10" />
              )}

              <div
                className={`absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-gray-900 flex items-center justify-center ${
                  log.type === 'success'
                    ? 'bg-green-500'
                    : log.type === 'download'
                    ? 'bg-blue-500'
                    : log.type === 'error'
                    ? 'bg-red-500'
                    : log.type === 'warning'
                    ? 'bg-yellow-500'
                    : 'bg-gray-600'
                }`}
              />

              <div className="flex flex-col">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs font-bold text-gray-300 mb-0.5 flex items-center gap-1.5 min-w-0">
                    {getIcon(log.type)}
                    <span className="truncate">{log.playlistName}</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono tabular-nums shrink-0">
                    {formatTime(log.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-gray-200 leading-snug break-words">
                  {log.message}
                </p>

                {log.details && (
                  <div className="mt-1.5">
                    {hasMultilineDetails && (
                      <div className="flex items-center justify-between mb-1">
                        <button
                          type="button"
                          onClick={() => toggleExpand(log.id)}
                          className="text-[11px] text-yoto-orange hover:underline flex items-center gap-1 font-medium"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={12} />
                              <span>Hide Diagnostic Output</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown size={12} />
                              <span>Show Zotify / API Output</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(log.id, `${log.message}\n${log.details}`)
                          }
                          className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1 font-mono"
                        >
                          {copiedId === log.id ? (
                            <>
                              <Check size={10} className="text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={10} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {(!hasMultilineDetails || isExpanded) && (
                      <pre className="text-[11px] text-gray-300 bg-black/50 p-2.5 rounded-lg border border-white/10 font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto custom-scrollbar leading-relaxed">
                        {log.details}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};