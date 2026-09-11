import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, ChatMessage } from '../shared/types.ts';
import type { ClientState } from '../shared/engine.ts';
import type { BrowserTransferResult } from '../shared/browser-transfer.ts';
import {
  clearSavedRoom, getPlayerId, getResumeKey, getSavedName, getSavedRoom,
  saveName, savePlayerId, saveResumeKey, saveRoom, socket, takeFirstVisit,
} from './socket.ts';
import { finishBrowserTransfer, incomingBrowserTransferToken, readBrowserTransfer } from './browser-transfer.ts';
import { getAudioPrefs, playSfx, setMusic, setSfx, unlockAudio } from './audio.ts';
import { useLang } from './i18n.tsx';
import { Home } from './components/Home.tsx';
import { Lobby } from './components/Lobby.tsx';
import { Game } from './components/Game.tsx';
import { Chat } from './components/Chat.tsx';
import { FullscreenHelp } from './components/FullscreenHelp.tsx';

export interface LobbyData {
  roomId: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  players: { id: string; name: string; connected: boolean; isAI: boolean }[];
}

type Screen = 'home' | 'lobby' | 'game';

// Keep at most this many chat lines client-side, mirroring the server's history cap so the
// two stay in sync and memory can't grow without bound in a long, chatty session.
const CHAT_CLIENT_CAP = 60;

// iPadOS and older WebKit builds expose the Fullscreen API with a prefix. Keeping
// the fallback here also makes the button fail gracefully inside in-app WebViews.
type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function launchedAsInstalledApp(): boolean {
  const nav = navigator as StandaloneNavigator;
  return nav.standalone === true
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: standalone)').matches;
}

export function App() {
  const { lang, setLang, t } = useLang();
  const [screen, setScreen] = useState<Screen>('home');
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [game, setGame] = useState<ClientState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<{ pageViews: number; visitors: number } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [audio, setAudio] = useState(getAudioPrefs);
  const [fullscreen, setFullscreen] = useState(false);
  const [installedApp] = useState(launchedAsInstalledApp);
  const [fullscreenHelp, setFullscreenHelp] = useState(false);
  const [incomingTransfer] = useState(readBrowserTransfer);
  const pendingTransfer = useRef(incomingTransfer);
  const [transferStatus, setTransferStatus] = useState<'loading' | 'error' | 'moved' | null>(incomingTransfer ? 'loading' : null);
  const playerId = useRef(getPlayerId());
  const pageviewSent = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    playSfx('error');
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Browsers only allow audio to start after a user gesture — arm it on the first one.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const toggleSfx = useCallback(() => {
    const on = !getAudioPrefs().sfx;
    setSfx(on);
    if (on) playSfx('click');
    setAudio((a) => ({ ...a, sfx: on }));
  }, []);
  const toggleMusic = useCallback(() => {
    const on = !getAudioPrefs().music;
    setMusic(on);
    setAudio((a) => ({ ...a, music: on }));
  }, []);

  // Fullscreen can only start from a direct user gesture. Sync from the browser's
  // event as users can also leave it with Back/Escape or by switching apps.
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(currentFullscreenElement()));
    const showFullscreenHelp = () => setFullscreenHelp(true);
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    document.addEventListener('fullscreenerror', showFullscreenHelp);
    document.addEventListener('webkitfullscreenerror', showFullscreenHelp);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
      document.removeEventListener('fullscreenerror', showFullscreenHelp);
      document.removeEventListener('webkitfullscreenerror', showFullscreenHelp);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;

    try {
      if (currentFullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        else throw new Error('Fullscreen exit is unavailable');
      } else if (root.requestFullscreen) {
        // navigationUI is a preference: supporting mobile browsers use it to hide
        // their address/navigation bars and may ignore it when policy requires UI.
        await root.requestFullscreen({ navigationUI: 'hide' });
      } else if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
      } else {
        throw new Error('Fullscreen is unavailable');
      }
    } catch {
      setFullscreenHelp(true);
    }
  }, []);

  const acceptSeat = useCallback(({ roomId, playerId: id, name, resumeKey }: {
    roomId: string; playerId: string; name?: string; resumeKey?: string;
  }) => {
    playerId.current = id;
    savePlayerId(id);
    saveRoom(roomId);
    if (name) saveName(name);
    if (resumeKey) saveResumeKey(roomId, resumeKey);
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url);
    if (pendingTransfer.current) {
      pendingTransfer.current = null;
      finishBrowserTransfer();
      setTransferStatus(null);
    }
  }, []);

  const resumeBrowserTransfer = useCallback(() => {
    const pending = pendingTransfer.current;
    if (!pending) return;
    setTransferStatus('loading');
    socket.timeout(8000).emit('resumeBrowserTransfer', pending, (error: Error | null, result: BrowserTransferResult) => {
      // A private joined event may already have completed a claim whose ack was lost.
      if (pendingTransfer.current !== pending) return;
      if (error || !result?.ok) { setTransferStatus('error'); return; }
      acceptSeat(result);
    });
  }, [acceptSeat]);

  const closeTransferStatus = useCallback(() => {
    pendingTransfer.current = null;
    finishBrowserTransfer();
    clearSavedRoom();
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
    setTransferStatus(null);
    socket.connect();
  }, []);

  useEffect(() => {
    const receiveTransfer = () => {
      const token = incomingBrowserTransferToken();
      if (!token || token === pendingTransfer.current?.token) return;
      // Pasting a #resume link into an existing Safari tab need not remount the
      // app. Start with a fresh, unjoined socket: this tab may already occupy an
      // unrelated seat, and a stale joined/ack must not erase the new link.
      pendingTransfer.current = null;
      socket.off('joined', acceptSeat);
      socket.disconnect();
      window.location.reload();
    };
    const restoreTransfer = (event: PageTransitionEvent) => {
      if (event.persisted) receiveTransfer();
    };
    window.addEventListener('hashchange', receiveTransfer);
    window.addEventListener('pageshow', restoreTransfer);
    return () => {
      window.removeEventListener('hashchange', receiveTransfer);
      window.removeEventListener('pageshow', restoreTransfer);
    };
  }, [acceptSeat]);

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      // Count this page load exactly once (not again on later reconnects).
      if (!pageviewSent.current) {
        pageviewSent.current = true;
        socket.emit('pageview', { first: takeFirstVisit() });
      }
      // A transfer must be redeemed before considering this browser's saved seat.
      // Safari may have no saved identity, or a completely different one.
      if (pendingTransfer.current) { resumeBrowserTransfer(); return; }
      // Auto-resume: on (re)connect, if the URL points at a room and we've played
      // before (saved name), rejoin to reclaim our seat after a refresh or network blip.
      const linkedRoom = new URLSearchParams(window.location.search).get('room');
      // Installed PWAs start at the manifest's fixed start_url, which cannot retain a
      // room query. Restore the last joined room there so a Home-screen launch resumes it.
      const room = linkedRoom || (installedApp ? getSavedRoom() : '');
      const savedName = getSavedName();
      if (room && savedName) {
        socket.emit('join', { roomId: room, playerId: playerId.current, name: savedName, resumeKey: getResumeKey(room) });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      if (pendingTransfer.current) setTransferStatus('error');
    });
    socket.on('stats', (s: { pageViews: number; visitors: number }) => setStats(s));
    socket.on('joined', acceptSeat);
    socket.on('sessionMoved', () => {
      socket.disconnect();
      setFullscreenHelp(false);
      setGame(null);
      setLobby(null);
      setMessages([]);
      setScreen('home');
      setTransferStatus('moved');
    });
    socket.on('lobby', (data: LobbyData) => {
      setLobby(data);
      setGame(null);
      setScreen('lobby');
    });
    socket.on('state', (state: ClientState) => {
      setGame(state);
      setScreen('game');
    });
    socket.on('errorMsg', ({ message }: { message: string }) => showToast(message));
    socket.on('chatHistory', (history: ChatMessage[]) =>
      setMessages(Array.isArray(history) ? history.slice(-CHAT_CLIENT_CAP) : []),
    );
    socket.on('chatMsg', (m: ChatMessage) =>
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        const next = [...prev, m];
        return next.length > CHAT_CLIENT_CAP ? next.slice(-CHAT_CLIENT_CAP) : next;
      }),
    );
    socket.connect();
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('stats');
      socket.off('joined');
      socket.off('sessionMoved');
      socket.off('lobby');
      socket.off('state');
      socket.off('errorMsg');
      socket.off('chatHistory');
      socket.off('chatMsg');
    };
  }, [acceptSeat, installedApp, resumeBrowserTransfer, showToast]);

  const join = useCallback((roomId: string, name: string) => {
    saveName(name);
    socket.emit('join', { roomId, playerId: playerId.current, name, resumeKey: getResumeKey(roomId) });
  }, []);

  const sendAction = useCallback((action: Action) => {
    socket.emit('action', { action });
  }, []);

  const sendChat = useCallback((text: string) => {
    socket.emit('chat', { text });
  }, []);

  return (
    <div className={`app app-${screen}`}>
      <header className="topbar">
        <span className="brand">
          <span className="ball" /> Splendor <em>{t('tagline')}</em>
        </span>
        <div className="topbar-right">
          {stats && (
            <span className="visits" title={t('visits_title', { views: stats.pageViews, visitors: stats.visitors })}>
              👁 {stats.pageViews.toLocaleString()} · 🧍 {stats.visitors.toLocaleString()}
            </span>
          )}
          <div className="lang-toggle" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'ko' ? 'active' : ''} onClick={() => setLang('ko')}>한</button>
          </div>
          <div className="audio-toggle" role="group" aria-label={t('audio_label')}>
            <button
              className={audio.music ? 'active' : ''}
              aria-pressed={audio.music}
              onClick={toggleMusic}
              title={audio.music ? t('audio_musicOn') : t('audio_musicOff')}
            >{audio.music ? '🎵' : '🎶'}</button>
            <button
              className={audio.sfx ? 'active' : ''}
              aria-pressed={audio.sfx}
              onClick={toggleSfx}
              title={audio.sfx ? t('audio_sfxOn') : t('audio_sfxOff')}
            >{audio.sfx ? '🔊' : '🔇'}</button>
          </div>
          {!installedApp && (
            <button
              type="button"
              className={`fullscreen-toggle ${fullscreen ? 'active' : ''}`}
              aria-label={fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
              aria-pressed={fullscreen}
              title={fullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
              onClick={toggleFullscreen}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {fullscreen ? (
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                ) : (
                  <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
                )}
              </svg>
            </button>
          )}
          <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? t('conn_online') : t('conn_connecting')}</span>
        </div>
      </header>

      {screen === 'home' && !transferStatus && <Home defaultName={getSavedName()} onJoin={join} />}

      {transferStatus && (
        <div className="home">
          <div className="home-card" role="status">
            <h1>{t(`transfer_incoming_${transferStatus}`)}</h1>
            {transferStatus === 'error' && <>
              <p className="sub">{t('transfer_incoming_errorHint')}</p>
              <button className="btn primary" onClick={resumeBrowserTransfer}>{t('transfer_retry')}</button>
            </>}
            {transferStatus === 'moved' && <p className="sub">{t('transfer_movedHint')}</p>}
            {transferStatus !== 'loading' && <button className="btn ghost" onClick={closeTransferStatus}>{t('transfer_home')}</button>}
          </div>
        </div>
      )}

      {screen === 'lobby' && lobby && (
        <Lobby
          lobby={lobby}
          youId={playerId.current}
          onStart={() => socket.emit('startGame')}
          onAddAI={() => socket.emit('addAI')}
          onRemoveAI={() => socket.emit('removeAI')}
          onLeave={async () => {
            // Explicitly leaving must not keep a lobby seat reserved for a move.
            // Wait for the server before disconnecting, which can otherwise drop
            // the cancellation packet while a transport upgrade is in progress.
            await new Promise<void>((resolve) => {
              socket.timeout(2000).emit('cancelBrowserTransfer', {}, () => resolve());
            });
            clearSavedRoom();
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url);
            socket.disconnect();
            setTimeout(() => socket.connect(), 100);
            setScreen('home');
            setLobby(null);
            setMessages([]);
          }}
        />
      )}

      {screen === 'game' && game && (
        <Game
          state={game}
          onAction={sendAction}
          onRematch={() => socket.emit('rematch')}
          onLobby={() => socket.emit('returnToLobby')}
        />
      )}

      {(screen === 'lobby' || screen === 'game') && (
        <Chat messages={messages} youId={playerId.current} connected={connected} onSend={sendChat} />
      )}

      {toast && <div className="toast" role="alert">{toast}</div>}

      {fullscreenHelp && (
        <FullscreenHelp roomId={screen === 'home' ? null : lobby?.roomId || game?.roomId || null} onClose={() => setFullscreenHelp(false)} />
      )}
    </div>
  );
}
