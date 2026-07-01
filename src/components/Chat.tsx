import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/types.ts';
import { useLang } from '../i18n.tsx';

/** A floating chat widget shared across the lobby and game screens. State lives in
 *  <App> so messages survive lobby↔game transitions and reconnects; this component
 *  owns only the open/unread UI and auto-scroll. */
export function Chat({
  messages, youId, connected, onSend,
}: {
  messages: ChatMessage[];
  youId: string;
  connected: boolean;
  onSend: (text: string) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true); // is the list scrolled to (near) the bottom?
  const seenIds = useRef<Set<string>>(new Set()); // message ids already read or already counted

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Tracked by message id, not array position, so it survives the whole `messages` array
  // being replaced by chatHistory on reconnect and the server's rolling 60-line cap. While
  // open: mark everything read and stay pinned to the bottom unless the user scrolled up.
  // While closed: tally new messages from other players (echoes of your own don't count).
  useEffect(() => {
    if (open) {
      seenIds.current = new Set(messages.map((m) => m.id));
      setUnread(0);
      if (atBottom.current) scrollToBottom();
      return;
    }
    const others = messages.filter((m) => !seenIds.current.has(m.id) && m.playerId !== youId).length;
    if (others) setUnread((u) => u + others);
    seenIds.current = new Set(messages.map((m) => m.id));
  }, [messages, open, youId]);

  // Jump to the newest line whenever the panel is (re)opened.
  useEffect(() => { if (open) { atBottom.current = true; scrollToBottom(); } }, [open]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText('');
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} title={t('chat_title')} aria-label={t('chat_open')}>
        💬
        {unread > 0 && <span className="chat-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label={t('chat_title')}>
      <div className="chat-header">
        <span>{t('chat_title')}</span>
        <button className="chat-x" onClick={() => setOpen(false)} aria-label={t('chat_close')}>✕</button>
      </div>
      <div className="chat-msgs" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">{t('chat_empty')}</div>
        ) : (
          messages.map((m) => (
            <div className={`chat-msg ${m.playerId === youId ? 'mine' : ''}`} key={m.id}>
              {m.playerId !== youId && <span className="chat-name">{m.name}</span>}
              <span className="chat-bubble">{m.text}</span>
            </div>
          ))
        )}
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <input
          className="chat-input"
          value={text}
          maxLength={300}
          placeholder={connected ? t('chat_placeholder') : t('chat_offline')}
          disabled={!connected}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button className="btn primary chat-send" type="submit" disabled={!connected || !text.trim()}>
          {t('chat_send')}
        </button>
      </form>
    </div>
  );
}
