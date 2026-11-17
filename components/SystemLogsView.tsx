import React, { useState, useEffect, useCallback } from 'react';
import { ActivityLog, SystemLogEntry, SystemDiagnostics } from '../types';
import { getSystemLogs, clearSystemLogs } from '../services/api';
import { ZotifyAuthPanel } from './ZotifyAuthPanel';
import {
  Terminal,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle,
  Info,
  DownloadCloud,
  Search,
  FileText,
  Cpu,
  KeyRound,
  FolderOpen,
} from 'lucide-react';

interface Props {
  onBack: () => void;
}

interface UnifiedLogItem {
  id: string;
  timestamp: string;
  level: 'ERROR' | 'WARNING' | 'INFO' | 'SUCCESS' | 'DOWNLOAD';
  source: string;
  message: string;
  details?: string;
}

export const SystemLogsView: React.FC<Props> = ({ onBack }) => {
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [rawLogTail, setRawLogTail] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'structured' | 'raw'>('structured');
  const [levelFilter, setLevelFilter] = useState<'all' | 'errors' | 'zotify'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState<boolean>(false);

  const fetchLogs = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await getSystemLogs(250);
      setSystemLogs(res.logs || []);
      setActivityLogs(res.activity || []);
      setRawLogTail(res.rawLogTail || '');
      if (res.diagnostics) {
        setDiagnostics(res.diagnostics);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      await clearSystemLogs();
      await fetchLogs(true);
    } finally {
      setClearing(false);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1800);
  };

  // Merge structured systemLogs and activityLogs (deduplicated by timestamp+message)
  const unifiedLogs: UnifiedLogItem[] = React.useMemo(() => {
    const items: UnifiedLogItem[] = [];
    const seen = new Set<string>();

    for (const s of systemLogs) {
      const normLevel =
        s.level === 'ERROR'
          ? 'ERROR'
          : s.level === 'WARNING' || s.level === 'WARN'
          ? 'WARNING'
          : 'INFO';
      const dedupKey = `${s.message}|${s.details || ''}`;
      seen.add(dedupKey);
      items.push({
        id: `sys-${s.id}`,
        timestamp: s.timestamp,
        level: normLevel,
        source: s.logger || 'yotofy',
        message: s.message,
        details: s.details,
      });
    }

    for (const a of activityLogs) {
      const tsStr =
        a.timestamp instanceof Date ? a.timestamp.toISOString() : String(a.timestamp);
      const prefixedMsg = `[${a.playlistName}] ${a.message}`;
      const dedupKey = `${prefixedMsg}|${a.details || ''}`;
      if (seen.has(dedupKey)) continue;

      const normLevel: UnifiedLogItem['level'] =
        a.type === 'error'
          ? 'ERROR'
          : a.type === 'warning'
          ? 'WARNING'
          : a.type === 'download'
          ? 'DOWNLOAD'
          : a.type === 'success'
          ? 'SUCCESS'
          : 'INFO';

      items.push({
        id: `act-${a.id}`,
        timestamp: tsStr,
        level: normLevel,
        source: a.playlistName,
        message: a.message,
        details: a.details,
      });
    }

    return items.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return tb - ta;
    });
  }, [systemLogs, activityLogs]);

  const filteredLogs = React.useMemo(() => {
    return unifiedLogs.filter((item) => {
      if (levelFilter === 'errors' && item.level !== 'ERROR' && item.level !== 'WARNING') {
        return false;
      }
      if (levelFilter === 'zotify') {
        const hay = `${item.source} ${item.message} ${item.details || ''}`.toLowerCase();
        if (
          !hay.includes('zotify') &&
          !hay.includes('download') &&
          !hay.includes('credentials.json') &&
          item.level !== 'DOWNLOAD'
        ) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = `${item.source} ${item.message} ${item.details || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [unifiedLogs, levelFilter, searchQuery]);

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const fullExportText = React.useMemo(() => {
    if (activeTab === 'raw' && rawLogTail) {
      return rawLogTail;
    }
    return filteredLogs
      .map(
        (l) =>
          `${l.timestamp} [${l.level}] (${l.source}) ${l.message}${
            l.details ? `\n${l.details}\n${'-'.repeat(50)}` : ''
          }`
      )
      .join('\n');
  }, [activeTab, rawLogTail, filteredLogs]);

  const getLevelBadge = (level: UnifiedLogItem['level']) => {
    switch (level) {
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-red-500/15 text-red-400 border border-red-500/30">
            <AlertCircle size={11} />
            ERROR
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <AlertCircle size={11} />
            WARN
          </span>
        );
      case 'DOWNLOAD':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
            <DownloadCloud size={11} />
            ZOTIFY
          </span>
        );
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle size={11} />
            OK
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-white/10 text-gray-300 border border-white/10">
            <Info size={11} />
            INFO
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col space-y-6 animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors text-sm font-medium whitespace-nowrap"
          >
            &larr; Back
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-spotify-green/15 border border-spotify-green/30 flex items-center justify-center">
              <Terminal size={20} className="text-spotify-green" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                System &amp; Zotify Diagnostic Logs
              </h2>
              <p className="text-xs text-gray-400">
                Full Zotify CLI command, exit codes, stdout/stderr, and Yoto API diagnostics — no SSH required
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
              autoRefresh
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
              }`}
            />
            <span>Live Tail (3s)</span>
          </button>

          <button
            type="button"
            onClick={() => fetchLogs(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => handleCopyText('all', fullExportText)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-200 transition-colors"
          >
            {copiedId === 'all' ? (
              <>
                <Check size={13} className="text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Copy Visible Logs</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleClearLogs}
            disabled={clearing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-xs font-medium text-red-300 transition-colors disabled:opacity-50"
          >
            <Trash2 size={13} />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>

      {/* Zotify Login5 Credential Generator (Headless Docker / NAS Helper) */}
      <ZotifyAuthPanel onStatusChanged={() => fetchLogs(false)} />

      {/* Runtime Environment & Zotify Diagnostics Strip */}
      {diagnostics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className={`p-4 rounded-xl border ${
              diagnostics.credentialsValid
                ? 'bg-gray-900 border-white/10'
                : 'bg-red-500/10 border-red-500/30'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1.5 font-medium">
                <KeyRound size={13} className="text-yoto-orange" />
                Zotify Credentials File
              </span>
              <span
                className={`font-mono font-bold ${
                  diagnostics.credentialsValid ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {diagnostics.credentialsValid
                  ? `VALID (${diagnostics.credentialsUsername || `${diagnostics.credentialsSize}B`})`
                  : diagnostics.credentialsExists
                  ? `EMPTY / INVALID (${diagnostics.credentialsSize}B)`
                  : 'MISSING'}
              </span>
            </div>
            <p className="text-xs font-mono text-gray-200 truncate" title={diagnostics.credentialsPath}>
              {diagnostics.credentialsPath}
            </p>
            {!diagnostics.credentialsValid && (
              <p className="text-[11px] text-red-300 mt-1">
                {diagnostics.credentialsError ||
                  'Use the Zotify Login5 Credential Generator above to create /app/data/credentials.json'}
              </p>
            )}
          </div>

          <div className="p-4 rounded-xl bg-gray-900 border border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Cpu size={13} className="text-spotify-green" />
                Googolplexed0/zotify CLI
              </span>
              <span
                className={`font-mono font-bold ${
                  diagnostics.zotifyAvailable ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {diagnostics.zotifyAvailable ? 'INSTALLED' : 'NOT IN PATH'}
              </span>
            </div>
            <p className="text-xs font-mono text-gray-300 truncate">
              PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python
            </p>
          </div>

          <div className="p-4 rounded-xl bg-gray-900 border border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Cpu size={13} className="text-blue-400" />
                FFmpeg Audio Transcoder
              </span>
              <span
                className={`font-mono font-bold ${
                  diagnostics.ffmpegAvailable ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {diagnostics.ffmpegAvailable ? 'AVAILABLE' : 'NOT FOUND'}
              </span>
            </div>
            <p className="text-xs font-mono text-gray-300 truncate">
              192kbps CBR MP3 / Loudnorm -16 LUFS
            </p>
          </div>

          <div className="p-4 rounded-xl bg-gray-900 border border-white/10">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1.5 font-medium">
                <FolderOpen size={13} className="text-purple-400" />
                Persistent Log File
              </span>
              <span className="font-mono text-gray-300 tabular-nums">
                {unifiedLogs.length} events
              </span>
            </div>
            <p className="text-xs font-mono text-gray-200 truncate" title={diagnostics.logFilePath}>
              {diagnostics.logFilePath}
            </p>
          </div>
        </div>
      )}

      {/* Filter & View Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-900 p-4 rounded-2xl border border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('structured')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              activeTab === 'structured'
                ? 'bg-white text-black'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            <Terminal size={13} />
            <span>Structured Subprocess &amp; API Logs ({filteredLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors ${
              activeTab === 'raw'
                ? 'bg-white text-black'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            <FileText size={13} />
            <span>Raw yotofy.log Tail</span>
          </button>
        </div>

        {activeTab === 'structured' && (
          <div className="flex flex-wrap items-center gap-3 flex-1 sm:flex-initial justify-end">
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setLevelFilter('all')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  levelFilter === 'all'
                    ? 'bg-white/15 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setLevelFilter('errors')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  levelFilter === 'errors'
                    ? 'bg-red-500/20 text-red-300'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Errors &amp; Warnings
              </button>
              <button
                type="button"
                onClick={() => setLevelFilter('zotify')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  levelFilter === 'zotify'
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Zotify CLI
              </button>
            </div>

            <div className="relative min-w-[220px]">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by track, exit code, stderr..."
                className="w-full bg-black/50 border border-white/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-yoto-orange focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Log Content Area */}
      {activeTab === 'structured' ? (
        <div className="bg-gray-900 rounded-2xl border border-white/10 overflow-hidden">
          {filteredLogs.length === 0 ? (
            <div className="py-16 px-6 text-center text-gray-400 space-y-2">
              <Terminal size={28} className="mx-auto text-gray-600" />
              <p className="text-sm font-semibold text-white">No matching log entries</p>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Trigger a playlist sync or adjust your filter above. Every Zotify subprocess
                command, exit code, stdout, and stderr trace will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/10 max-h-[680px] overflow-y-auto custom-scrollbar">
              {filteredLogs.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 transition-colors ${
                    item.level === 'ERROR'
                      ? 'bg-red-500/[0.04] hover:bg-red-500/[0.07]'
                      : item.level === 'WARNING'
                      ? 'bg-amber-500/[0.03] hover:bg-amber-500/[0.06]'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                      <span className="text-xs font-mono tabular-nums text-gray-500 shrink-0">
                        {formatTimestamp(item.timestamp)}
                      </span>
                      {getLevelBadge(item.level)}
                      <span className="text-xs font-mono font-semibold text-yoto-orange bg-yoto-orange/10 px-2 py-0.5 rounded border border-yoto-orange/20">
                        {item.source}
                      </span>
                      <span className="text-sm font-medium text-white break-words">
                        {item.message}
                      </span>
                    </div>

                    {item.details && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(
                            item.id,
                            `${item.timestamp} [${item.level}] ${item.source}: ${item.message}\n${item.details}`
                          )
                        }
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-gray-300 shrink-0"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check size={11} className="text-emerald-400" />
                            <span className="text-emerald-300">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>Copy Output</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {item.details && (
                    <pre className="mt-3 p-3.5 rounded-xl bg-black/70 border border-white/10 text-xs font-mono text-gray-200 whitespace-pre-wrap break-words overflow-x-auto max-h-96 custom-scrollbar leading-relaxed">
                      {item.details}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl border border-white/10 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-gray-400">
              {diagnostics?.logFilePath || '/app/data/yotofy.log'} (last 250 lines)
            </span>
          </div>
          <pre className="p-4 rounded-xl bg-black/80 border border-white/10 text-xs font-mono text-gray-200 whitespace-pre-wrap break-words overflow-x-auto max-h-[640px] custom-scrollbar leading-relaxed">
            {rawLogTail || 'No raw log lines written to yotofy.log yet.'}
          </pre>
        </div>
      )}
    </div>
  );
};
