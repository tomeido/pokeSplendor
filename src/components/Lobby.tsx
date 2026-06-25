import { useState } from 'react';
import type { LobbyData } from '../App.tsx';
import { useLang } from '../i18n.tsx';

export function Lobby({
  lobby, youId, onStart, onLeave, onAddAI, onRemoveAI,
}: {
  lobby: LobbyData;
  youId: string;
  onStart: () => void;
  onLeave: () => void;
  onAddAI: () => void;
  onRemoveAI: () => void;
}) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const isHost = lobby.hostId === youId;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${lobby.roomId}`;
  const aiCount = lobby.players.filter((p) => p.isAI).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the field is selectable as a fallback */
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="room-code">
          <span className="label">{t('lobby_roomCode')}</span>
          <span className="code">{lobby.roomId}</span>
        </div>

        <div className="share">
          <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={copy}>{copied ? t('lobby_copied') : t('lobby_copyLink')}</button>
        </div>
        <p className="hint">{t('lobby_shareHint')}</p>

        <div className="seat-list">
          {lobby.players.map((p, i) => (
            <div className={`seat ${p.connected ? '' : 'offline'} ${p.isAI ? 'ai' : ''}`} key={p.id}>
              <span className="seat-num">{i + 1}</span>
              <span className="seat-name">
                {p.name}
                {p.id === youId && <em>{t('lobby_you')}</em>}
                {p.id === lobby.hostId && <span className="host-badge">{t('lobby_host')}</span>}
              </span>
              {!p.isAI && <span className="seat-dot" title={p.connected ? 'connected' : 'disconnected'} />}
            </div>
          ))}
          {Array.from({ length: Math.max(0, 4 - lobby.players.length) }).map((_, i) => (
            <div className="seat empty" key={`empty-${i}`}>
              <span className="seat-num">{lobby.players.length + i + 1}</span>
              <span className="seat-name muted">{t('lobby_waiting')}</span>
            </div>
          ))}
        </div>

        {isHost && (
          <div className="ai-controls">
            <button className="btn ghost" disabled={lobby.players.length >= 4} onClick={onAddAI}>
              {t('lobby_addAI')}
            </button>
            <button className="btn ghost" disabled={aiCount === 0} onClick={onRemoveAI}>
              {t('lobby_removeAI')}
            </button>
          </div>
        )}
        {isHost && aiCount === 0 && lobby.players.length < 2 && (
          <p className="hint solo-hint">{t('lobby_solo')}</p>
        )}

        <div className="lobby-actions">
          {isHost ? (
            <button className="btn primary" disabled={lobby.players.length < 2} onClick={onStart}>
              {lobby.players.length < 2 ? t('lobby_need') : t('lobby_start', { n: lobby.players.length })}
            </button>
          ) : (
            <div className="waiting">{t('lobby_waitingHost')}</div>
          )}
          <button className="btn ghost" onClick={onLeave}>{t('lobby_leave')}</button>
        </div>
      </div>
    </div>
  );
}
