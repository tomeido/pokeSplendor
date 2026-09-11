// A browser switch carries a one-time ticket, never the public player ID or a
// reusable reconnect key. Fragments are not sent in HTTP requests or referrers.
const PENDING_KEY = 'poke-splendor-browser-transfer';
const ISSUED_KEY = 'poke-splendor-issued-transfer';

export interface PendingBrowserTransfer { token: string; claimId: string }

export function clearBrowserTransferFragment(token?: string): void {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.has('resume') || (token && fragment.get('resume') !== token)) return;
  fragment.delete('resume');
  url.hash = fragment.toString();
  url.searchParams.delete('handoff');
  window.history.replaceState({}, '', url);
  try { sessionStorage.removeItem(ISSUED_KEY); } catch { /* optional */ }
}

// Check without consuming/removing the source tab's staged link. Lifecycle
// listeners also run when Kakao returns from its native share sheet.
export function incomingBrowserTransferToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('resume');
  try {
    if (token && sessionStorage.getItem(ISSUED_KEY) === token) return null;
  } catch { /* incoming links still work without session storage */ }
  return token;
}

export function readBrowserTransfer(): PendingBrowserTransfer | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('resume');
  let saved: PendingBrowserTransfer | null = null;
  try {
    // Reloading the source tab must not consume the link intended for Safari.
    if (token && sessionStorage.getItem(ISSUED_KEY) === token) {
      clearBrowserTransferFragment(token);
      return null;
    }
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    if (typeof value?.token === 'string' && typeof value?.claimId === 'string') saved = value;
  } catch { /* the incoming link still works without session storage */ }
  // Following an ordinary invite must never redeem an older failed move just
  // because this tab still has a pending claim saved from another page.
  if (!token) return null;
  const claimId = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const pending = saved?.token === token ? saved : { token, claimId: claimId() };
  // Keep this tab's secret claim ID across reloads so an acknowledgement lost to
  // a connection drop can be retried without making the shared ticket reusable.
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch { /* optional */ }
  return pending;
}

export function finishBrowserTransfer(): void {
  // Retain this tab's last private claim ID. The user may paste a copied link
  // more than once, so the same tab must be able to retry the same claim.
  // Ordinary URLs never read it without #resume,
  // another tab cannot claim with a new ID, and the server enforces the 5m TTL.
  clearBrowserTransferFragment();
}

export function browserTransferUrl(token: string): string {
  const url = new URL(window.location.href);
  // Force a document navigation even in a Safari tab running an older client
  // that does not yet listen for incoming hash-only links. This flag is public;
  // the private ticket stays exclusively in the fragment.
  url.searchParams.set('handoff', '1');
  url.hash = new URLSearchParams({ resume: token }).toString();
  return url.href;
}

export function stageBrowserTransfer(token: string): void {
  try { sessionStorage.setItem(ISSUED_KEY, token); } catch { /* optional */ }
  window.history.replaceState({}, '', browserTransferUrl(token));
}

export function isAppleMobile(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
