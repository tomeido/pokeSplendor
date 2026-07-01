import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, ChatMessage } from '../shared/types.ts';
import type { ClientState } from '../shared/engine.ts';
import { getPlayerId, getSavedName, saveName, socket, takeFirstVisit } from './socket.ts';
import { getAudioPrefs, playSfx, setMusic, setSfx, unlockAudio } from './audio.ts';
import { useLang } from './i18n.tsx';
import { Home } from './components/Home.tsx';
import { Lobby } from './components/Lobby.tsx';
import { Game } from './components/Game.tsx';
import { Chat } from './components/Chat.tsx';

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

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => {
      setConnected(true);
      // Count this page load exactly once (not again on later reconnects).
      if (!pageviewSent.current) {
        pageviewSent.current = true;
        socket.emit('pageview', { first: takeFirstVisit() });
      }
      // Auto-resume: on (re)connect, if the URL points at a room and we've played
      // before (saved name), rejoin to reclaim our seat after a refresh or network blip.
      const room = new URLSearchParams(window.location.search).get('room');
      const savedName = getSavedName();
      if (room && savedName) {
        socket.emit('join', { roomId: room, playerId: playerId.current, name: savedName });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('stats', (s: { pageViews: number; visitors: number }) => setStats(s));
    socket.on('joined', ({ roomId }: { roomId: string }) => {
      const url = new URL(window.location.href);
      url.searchParams.set('room', roomId);
      window.history.replaceState({}, '', url);
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
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('stats');
      socket.off('joined');
      socket.off('lobby');
      socket.off('state');
      socket.off('errorMsg');
      socket.off('chatHistory');
      socket.off('chatMsg');
    };
  }, [showToast]);

  const join = useCallback((roomId: string, name: string) => {
    saveName(name);
    socket.emit('join', { roomId, playerId: playerId.current, name });
  }, []);

  const sendAction = useCallback((action: Action) => {
    socket.emit('action', { action });
  }, []);

  const sendChat = useCallback((text: string) => {
    socket.emit('chat', { text });
  }, []);

  return (
    <div className="app">
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
          <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? t('conn_online') : t('conn_connecting')}</span>
        </div>
      </header>

      {screen === 'home' && <Home defaultName={getSavedName()} onJoin={join} />}

      {screen === 'lobby' && lobby && (
        <Lobby
          lobby={lobby}
          youId={playerId.current}
          onStart={() => socket.emit('startGame')}
          onAddAI={() => socket.emit('addAI')}
          onRemoveAI={() => socket.emit('removeAI')}
          onLeave={() => {
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
