import React, { useState, useEffect, useCallback } from 'react';
import { ZotifyCredentialsStatus } from '../types';
import {
  getZotifyCredentialsStatus,
  getZotifyAuthUrl,
  exchangeZotifyCode,
  saveZotifyCredentialsJson,
  autoProvisionZotifyFromSpotifyToken,
} from '../services/api';
import {
  KeyRound,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  FileJson,
  ChevronDown,
  ChevronUp,
  Wand2,
  ClipboardPaste,
  BookOpen,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';

interface Props {
  onStatusChanged?: (status: ZotifyCredentialsStatus) => void;
  defaultShowGuide?: boolean;
}

export const ZotifyAuthPanel: React.FC<Props> = ({
  onStatusChanged,
  defaultShowGuide = true,
}) => {
  const [status, setStatus] = useState<ZotifyCredentialsStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authUrl, setAuthUrl] = useState<string>('');
  const [codeVerifier, setCodeVerifier] = useState<string>('');
  const [waitingForCallback, setWaitingForCallback] = useState<boolean>(false);
  const [redirectUrlOrCode, setRedirectUrlOrCode] = useState<string>('');
  const [rawJsonInput, setRawJsonInput] = useState<string>('');
  const [showRawJsonMode, setShowRawJsonMode] = useState<boolean>(false);
  const [showWizardWhenValid, setShowWizardWhenValid] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(defaultShowGuide);
  const [busy, setBusy] = useState<boolean>(false);
  const [autoProvisioning, setAutoProvisioning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getZotifyCredentialsStatus();
      setStatus(res);
      onStatusChanged?.(res);
      if (res.valid && waitingForCallback) {
        setWaitingForCallback(false);
        setSuccessMsg(
          `Automatically captured Login5 callback and saved ${res.path} (account: ${
            res.username || 'authenticated'
          })!`
        );
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [onStatusChanged, waitingForCallback]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Poll /api/auth/zotify/status while waiting for the background :4381 callback listener
  useEffect(() => {
    if (!waitingForCallback) return;
    const timer = setInterval(async () => {
      try {
        const res = await getZotifyCredentialsStatus();
        setStatus(res);
        if (res.valid) {
          setWaitingForCallback(false);
          setShowWizardWhenValid(false);
          onStatusChanged?.(res);
          setSuccessMsg(
            `Automatically captured Login5 callback and saved ${res.path} (account: ${
              res.username || 'authenticated'
            })!`
          );
        }
      } catch {
        // ignore
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [waitingForCallback, onStatusChanged]);

  const handleAutoProvisionFromSpotify = async () => {
    setAutoProvisioning(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await autoProvisionZotifyFromSpotifyToken();
      setStatus(res);
      onStatusChanged?.(res);
      setShowWizardWhenValid(false);
      setSuccessMsg(
        `Programmatically generated ${res.path} from your connected Spotify token (account: ${
          res.username || 'authenticated'
        })!`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Auto-provisioning failed. Please use Step 1 & Step 2 below.'
      );
    } finally {
      setAutoProvisioning(false);
    }
  };

  const handleStartLogin5Link = async () => {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const data = await getZotifyAuthUrl();
      setAuthUrl(data.authUrl);
      setCodeVerifier(data.codeVerifier);
      setWaitingForCallback(true);
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to generate Zotify Login5 URL'
      );
    } finally {
      setBusy(false);
    }
  };

  const performCodeExchange = async (inputVal: string) => {
    const trimmed = inputVal.trim();
    if (!trimmed) {
      setErrorMsg(
        'Paste the redirected URL (http://127.0.0.1:4381/login?code=...) from your browser address bar.'
      );
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await exchangeZotifyCode(trimmed, codeVerifier);
      setStatus(res);
      onStatusChanged?.(res);
      setRedirectUrlOrCode('');
      setWaitingForCallback(false);
      setShowWizardWhenValid(false);
      setSuccessMsg(
        `Saved reusable Zotify Login5 credentials to ${res.path} (account: ${
          res.username || 'authenticated'
        }). Future syncs will use this credential automatically.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Zotify Login5 exchange failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePasteFromClipboardAndExchange = async () => {
    setErrorMsg(null);
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText || !clipText.trim()) {
        setErrorMsg(
          'Clipboard is empty. Copy the http://127.0.0.1:4381/login?code=... URL from your browser address bar first.'
        );
        return;
      }
      setRedirectUrlOrCode(clipText.trim());
      await performCodeExchange(clipText.trim());
    } catch {
      setErrorMsg(
        'Browser blocked clipboard read permission. Paste the URL into the input box above and click "2. Exchange Code & Save credentials.json".'
      );
    }
  };

  const handleSaveRawJson = async () => {
    if (!rawJsonInput.trim()) {
      setErrorMsg('Paste the JSON contents of your credentials.json file first.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await saveZotifyCredentialsJson(rawJsonInput.trim());
      setStatus(res);
      onStatusChanged?.(res);
      setRawJsonInput('');
      setShowRawJsonMode(false);
      setWaitingForCallback(false);
      setShowWizardWhenValid(false);
      setSuccessMsg(
        `Saved Zotify Login5 credentials to ${res.path} (account: ${
          res.username || 'authenticated'
        }).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save credentials.json');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCmd = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopiedCmd(id);
    setTimeout(() => {
      setCopiedCmd((prev) => (prev === id ? null : prev));
    }, 1800);
  };

  const isValid = Boolean(status?.valid);
  const showSetup = !isValid || showWizardWhenValid;
  const credPath = status?.path || '/app/data/credentials.json';

  return (
    <div
      className={`rounded-2xl p-6 border transition-colors space-y-5 ${
        isValid
          ? 'bg-gray-900 border-white/10'
          : 'bg-amber-500/[0.06] border-amber-500/40'
      }`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              isValid
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
            }`}
          >
            <KeyRound size={19} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-white">
                Googolplexed0/zotify Login5 Credentials (<code>credentials.json</code>)
              </h3>
              {loading ? (
                <span className="text-xs font-mono text-gray-400 flex items-center gap-1">
                  <RefreshCw size={11} className="animate-spin" />
                  Checking...
                </span>
              ) : isValid ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle size={12} />
                  VALID ({status?.username || 'Authenticated'} · {status?.size || 0}B)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                  <AlertCircle size={12} />
                  MISSING OR EMPTY ({status?.size || 0}B)
                </span>
              )}
            </div>
            <p className="text-xs text-gray-300 mt-1 max-w-3xl leading-relaxed">
              Target file:{' '}
              <code className="text-yoto-orange font-mono">{credPath}</code>.{' '}
              <code>Googolplexed0/zotify</code> requires a permanent{' '}
              <code>librespot</code> Login5 credential file to stream and download 320kbps MP3
              tracks from Spotify.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 flex items-center gap-1.5 font-medium"
          >
            <BookOpen size={13} className="text-yoto-orange" />
            <span>{showGuide ? 'Hide Instructions' : 'Step-by-Step Guide'}</span>
          </button>

          {isValid && (
            <button
              type="button"
              onClick={() => setShowWizardWhenValid(!showWizardWhenValid)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 flex items-center gap-1.5 font-medium"
            >
              <span>{showWizardWhenValid ? 'Hide Setup Tools' : 'Re-authenticate Zotify'}</span>
              {showWizardWhenValid ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
      </div>

      {!isValid && status?.error && (
        <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-100 flex items-start gap-2">
          <AlertCircle size={15} className="text-amber-300 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{status.error}</span>
        </div>
      )}

      {/* Programmatic & Interactive Setup Tools */}
      {showSetup && (
        <div className="bg-black/40 rounded-xl p-4 border border-white/10 space-y-4">
          {/* Primary Recommended: 2-Step Headless NAS / Docker Keymaster PKCE Generator */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-spotify-green uppercase tracking-wider">
                Recommended (Headless NAS / Docker) — 2-Click Keymaster PKCE Generator
              </span>
              {waitingForCallback && (
                <span className="text-[11px] font-mono text-spotify-green flex items-center gap-1.5">
                  <RefreshCw size={11} className="animate-spin" />
                  Listening on :4381 &amp; ready for URL paste...
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Step 1 */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-3 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-spotify-green uppercase tracking-wider block">
                    Step 1 — Open Spotify Keymaster Login
                  </span>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Click the button below. A new tab will open to Spotify&apos;s official
                    Keymaster login (<code>client_id=65b708073fc0480ea92a077233ca87bd</code>).
                    Click <strong>Agree</strong>.
                  </p>
                  <p className="text-[11px] text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 leading-relaxed">
                    <strong>Note for NAS / Remote Docker:</strong> After clicking Agree, your
                    browser will redirect to{' '}
                    <code className="text-white">http://127.0.0.1:4381/login?code=AQB...</code>{' '}
                    and show <em>&ldquo;This site can&rsquo;t be reached&rdquo;</em> because
                    port 4381 is inside the NAS container. <strong>Do not close that tab</strong>{' '}
                    — copy the URL from its address bar for Step 2!
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={handleStartLogin5Link}
                    disabled={busy}
                    className="w-full py-2.5 px-4 rounded-lg bg-spotify-green hover:bg-green-500 text-black font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <span>1. Open Spotify Login5 Auth Link</span>
                    <ExternalLink size={13} />
                  </button>
                  {authUrl && (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[11px] text-spotify-green hover:underline font-mono truncate"
                    >
                      Popup blocked? Click here to open Spotify Login5 URL directly &rarr;
                    </a>
                  )}
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <span className="text-xs font-bold text-yoto-orange uppercase tracking-wider block">
                    Step 2 — Paste Redirected 127.0.0.1:4381 URL (or Code)
                  </span>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Copy the full{' '}
                    <code className="text-gray-200">
                      http://127.0.0.1:4381/login?code=AQB...
                    </code>{' '}
                    URL from your browser&apos;s address bar and either click{' '}
                    <strong>Paste Clipboard &amp; Save</strong> or paste it into the box:
                  </p>
                  <input
                    type="text"
                    value={redirectUrlOrCode}
                    onChange={(e) => setRedirectUrlOrCode(e.target.value)}
                    placeholder="http://127.0.0.1:4381/login?code=AQB..."
                    className="w-full bg-black/60 border border-white/20 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:border-yoto-orange focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handlePasteFromClipboardAndExchange}
                    disabled={busy}
                    className="py-2.5 px-3 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <ClipboardPaste size={13} className="text-yoto-orange" />
                    <span>Paste Clipboard &amp; Save</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => performCodeExchange(redirectUrlOrCode)}
                    disabled={busy || !redirectUrlOrCode.trim()}
                    className="py-2.5 px-3 rounded-lg bg-yoto-orange hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <KeyRound size={13} />
                    <span>
                      {busy ? 'Saving...' : '2. Exchange & Save'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Alternative Options: Direct JSON Paste & Token Auto-Provision */}
          <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowRawJsonMode(!showRawJsonMode)}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 font-medium"
            >
              <FileJson size={13} className="text-gray-400" />
              <span>
                {showRawJsonMode
                  ? 'Hide manual credentials.json paste'
                  : 'Already have a Keymaster credentials.json file? Click to paste JSON directly'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleAutoProvisionFromSpotify}
              disabled={autoProvisioning || busy}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Wand2 size={12} className="text-emerald-400" />
              <span>
                {autoProvisioning
                  ? 'Testing Spotify Token...'
                  : 'Test Auto-Provision from spotify_token.json'}
              </span>
            </button>
          </div>

          {showRawJsonMode && (
            <div className="space-y-2">
              <textarea
                rows={4}
                value={rawJsonInput}
                onChange={(e) => setRawJsonInput(e.target.value)}
                placeholder='{"username": "your_spotify_username", "credentials": "base64_reusable_credentials...", "type": "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS"}'
                className="w-full bg-black/60 border border-white/20 rounded-lg p-3 text-xs text-white font-mono placeholder-gray-500 focus:border-yoto-orange focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveRawJson}
                disabled={busy || !rawJsonInput.trim()}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                Save &amp; Verify Pasted credentials.json
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detailed Step-by-Step Instructions & Reference Guide (Built directly into the UI) */}
      {showGuide && (
        <div className="bg-black/50 rounded-xl p-5 border border-white/10 space-y-4 text-xs text-gray-300">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 font-bold text-white text-sm">
              <BookOpen size={15} className="text-yoto-orange" />
              <span>
                Complete Step-by-Step Guide: Setting Up Zotify Credentials on Your NAS / Docker
              </span>
            </div>
            <span className="text-[11px] font-mono text-gray-400">
              Googolplexed0/zotify v0.22.0
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 leading-relaxed">
            <div className="space-y-2.5">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Why Zotify Needs Separate Login5 Credentials
              </h4>
              <p className="text-gray-400">
                Connecting Spotify at the top of Config saves a standard Web API token (
                <code className="text-gray-200">/app/data/spotify_token.json</code>) used by{' '}
                <code>spotipy</code> to list your playlists. However, downloading encrypted Ogg
                / MP3 audio streams via <code>Googolplexed0/zotify</code> requires a{' '}
                <strong>Spotify Access Point (Login5)</strong> session stored in{' '}
                <code className="text-yoto-orange">/app/data/credentials.json</code>.
              </p>
              <p className="text-gray-400">
                When <code>/app/data/credentials.json</code> is missing or 0 bytes, Zotify tries
                to open a local callback server inside the container at{' '}
                <code>http://127.0.0.1:4381/login</code>, which times out after 120 seconds on a
                headless NAS (<code>Callback server timed out</code> / <code>Login5 failed! 98</code>).
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Step-by-Step Instructions (Do This Once)
              </h4>
              <ol className="list-decimal list-inside space-y-1.5 text-gray-300">
                <li>
                  <strong>Try Option A first:</strong> Click{' '}
                  <strong className="text-emerald-300">Try 1-Click Auto-Provision</strong> above.
                  If your Spotify token already has streaming permissions accepted by Spotify&apos;s
                  AP, it will create <code>/app/data/credentials.json</code> immediately.
                </li>
                <li>
                  <strong>If Option A is rejected by Spotify AP, use Option B:</strong> Click{' '}
                  <strong className="text-spotify-green">1. Open Spotify Login5 Auth Link</strong>.
                </li>
                <li>
                  Log into Spotify in the new tab and click <strong>Agree</strong>.
                </li>
                <li>
                  Your browser will redirect to{' '}
                  <code className="text-white">http://127.0.0.1:4381/login?code=AQB...</code> and
                  show an error page (<em>&ldquo;This site can&rsquo;t be reached&rdquo;</em>).
                  Highlight and copy that entire URL from your browser&apos;s address bar.
                </li>
                <li>
                  Return here and click{' '}
                  <strong className="text-yoto-orange">Paste Clipboard &amp; Save</strong> (or
                  paste the URL into Step 2 and click <strong>2. Exchange &amp; Save</strong>).
                </li>
                <li>
                  Verify the badge at the top of this box turns green:{' '}
                  <strong className="text-emerald-400">VALID (your_username)</strong>. Because{' '}
                  <code>/app/data</code> is volume-mounted on your NAS, you never need to repeat
                  this across container updates!
                </li>
              </ol>
            </div>
          </div>

          {/* Optional NAS Terminal / SSH Reference */}
          <div className="pt-3 border-t border-white/10 space-y-2">
            <span className="font-bold text-gray-200 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Terminal size={13} className="text-spotify-green" />
              <span>Optional NAS / Docker CLI Reference Commands</span>
            </span>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-black/60 p-3 rounded-lg border border-white/10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400 block mb-0.5">
                    Inspect saved credentials.json inside container:
                  </span>
                  <code className="text-[11px] font-mono text-gray-200 block truncate">
                    sudo docker exec yotofy-stack cat /app/data/credentials.json
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyCmd(
                      'cat-creds',
                      'sudo docker exec yotofy-stack cat /app/data/credentials.json'
                    )
                  }
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-gray-300 flex items-center gap-1 shrink-0"
                >
                  {copiedCmd === 'cat-creds' ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="bg-black/60 p-3 rounded-lg border border-white/10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400 block mb-0.5">
                    Expected JSON format in /app/data/credentials.json:
                  </span>
                  <code className="text-[11px] font-mono text-emerald-300 block truncate">
                    {`{"username":"...","credentials":"...","type":"AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS"}`}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyCmd(
                      'json-schema',
                      '{\n  "username": "YOUR_SPOTIFY_USERNAME",\n  "credentials": "BASE64_REUSABLE_CREDENTIALS",\n  "type": "AUTHENTICATION_STORED_SPOTIFY_CREDENTIALS"\n}'
                    )
                  }
                  className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-gray-300 flex items-center gap-1 shrink-0"
                >
                  {copiedCmd === 'json-schema' ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Template</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <span className="font-mono whitespace-pre-wrap break-words">{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2">
          <CheckCircle size={15} className="text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}
    </div>
  );
};
