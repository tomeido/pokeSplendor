import { useEffect, useRef, useState } from 'react';
import type { BrowserTransferTicket } from '../../shared/browser-transfer.ts';
import { browserTransferUrl, clearBrowserTransferFragment, isAppleMobile, stageBrowserTransfer } from '../browser-transfer.ts';
import { useLang } from '../i18n.tsx';
import { socket } from '../socket.ts';

export function FullscreenHelp({ roomId, onClose }: { roomId: string | null; onClose: () => void }) {
  const { t } = useLang();
  const [ticket, setTicket] = useState<{ token: string; expiresAt: number } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'expired'>(roomId ? 'loading' : 'ready');
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const apple = isAppleMobile();
  const kakao = /KAKAOTALK/i.test(navigator.userAgent);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let disposed = false;
    let issuedToken: string | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let requesting = false;
    setPhase('loading');
    setTicket(null);
    function request() {
      if (requesting || issuedToken || !socket.connected) return;
      requesting = true;
      socket.timeout(8000).emit('createBrowserTransfer', {}, (error: Error | null, result: BrowserTransferTicket) => {
        requesting = false;
        if (disposed) return;
        if (error || !result?.ok) { setPhase('error'); return; }
        issuedToken = result.token;
        setTicket(result);
        setPhase('ready');
        // Keep the address aligned with the copyable move link. Kakao's native
        // Share → Open in Safari may omit it, so the guide requires copy/paste.
        stageBrowserTransfer(result.token);
        expiry = setTimeout(() => {
          clearBrowserTransferFragment(result.token);
          setTicket(null);
          setPhase('expired');
        }, Math.max(0, result.expiresAt - Date.now()));
      });
    }
    socket.on('connect', request);
    if (socket.connected) request();
    else setPhase('error');
    return () => {
      disposed = true;
      socket.off('connect', request);
      if (expiry) clearTimeout(expiry);
      if (issuedToken) clearBrowserTransferFragment(issuedToken);
    };
  }, [roomId, attempt]);

  const link = ticket ? browserTransferUrl(ticket.token) : window.location.href;
  const ready = !roomId || phase === 'ready';

  async function copyLink() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      dialog.current?.querySelector('input')?.select();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal fullscreen-help"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fullscreen-help-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key !== 'Tab') return;
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || []);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
      >
        <h2 id="fullscreen-help-title">{t('fullscreen_helpTitle')}</h2>
        {roomId && <p role="status">{t(`transfer_${phase}`)}</p>}
        {ready && <>
          {kakao && <p>{t(apple ? 'fullscreen_helpKakaoIOS' : 'fullscreen_helpKakao')}</p>}
          <p>{t(apple ? 'fullscreen_helpIOS' : 'fullscreen_helpAndroid')}</p>
          {roomId && <p className="transfer-private">{t('transfer_private')}</p>}
          <div className="share fullscreen-share">
            <input readOnly value={link} aria-label={t('fullscreen_linkLabel')} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="btn" onClick={copyLink}>
              {copied ? t('fullscreen_linkCopied') : t(roomId ? 'transfer_copyLink' : 'fullscreen_copyLink')}
            </button>
          </div>
          {copyFailed && <p role="alert">{t('fullscreen_copyFailed')}</p>}
        </>}
        {roomId && (phase === 'error' || phase === 'expired') && (
          <button type="button" className="btn" onClick={() => { setCopied(false); setCopyFailed(false); setAttempt((value) => value + 1); }}>
            {t('transfer_retry')}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onClose}>{t('fullscreen_closeHelp')}</button>
      </div>
    </div>
  );
}
