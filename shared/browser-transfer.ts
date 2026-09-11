/** A short-lived link that lets one other browser claim the current game seat. */
export type BrowserTransferTicket =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: 'not_joined' };

/** The new reconnect key is private to the browser that redeemed the link. */
export type BrowserTransferResult =
  | { ok: true; roomId: string; playerId: string; name: string; resumeKey: string }
  | { ok: false; error: 'invalid_transfer' | 'already_joined' };
