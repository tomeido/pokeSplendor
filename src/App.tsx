import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '../shared/types.ts';
import type { ClientState } from '../shared/engine.ts';
import { getPlayerId, getSavedName, saveName, socket } from './socket.ts';
import { useLang } from './i18n.tsx';
import { Home } from './components/Home.tsx';
import { Lobby } from './components/Lobby.tsx';
import { Game } from './components/Game.tsx';

export interface LobbyData {
  roomId: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  players: { id: string; name: string; connected: boolean; isAI: boolean }[];
}

type Screen = 'home' | 'lobby' | 'game';

export function App() {
  const { lang, setLang, t } = useLang();
  const [screen, setScreen] = useState<Screen>('home');
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [game, setGame] = useState<ClientState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const playerId = useRef(getPlayerId());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => {
      setConnected(true);
      // Auto-resume: on (re)connect, if the URL points at a room and we've played
      // before (saved name), rejoin to reclaim our seat after a refresh or network blip.
      const room = new URLSearchParams(window.location.search).get('room');
      const savedName = getSavedName();
      if (room && savedName) {
        socket.emit('join', { roomId: room, playerId: playerId.current, name: savedName });
      }
    });
    socket.on('disconnect', () => setConnected(false));
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
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('joined');
      socket.off('lobby');
      socket.off('state');
      socket.off('errorMsg');
    };
  }, [showToast]);

  const join = useCallback((roomId: string, name: string) => {
    saveName(name);
    socket.emit('join', { roomId, playerId: playerId.current, name });
  }, []);

  const sendAction = useCallback((action: Action) => {
    socket.emit('action', { action });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="ball" /> Splendor <em>{t('tagline')}</em>
        </span>
        <div className="topbar-right">
          <div className="lang-toggle" role="group" aria-label="Language">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'ko' ? 'active' : ''} onClick={() => setLang('ko')}>한</button>
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
