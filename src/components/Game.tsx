import { useEffect, useRef, useState } from 'react';
import type { Action, Card, GemType, TokenType } from '../../shared/types.ts';
import { GEM_TYPES } from '../../shared/types.ts';
import type { ClientPlayer, ClientState } from '../../shared/engine.ts';
import { GEM_THEME } from '../../shared/data.ts';
import { playSfx, type Sfx } from '../audio.ts';
import { CardView, CostPip, Sprite, Token } from './bits.tsx';
import { formatLog, localizeCard, localizeNoble, useLang } from '../i18n.tsx';

const GEM_ORDER: GemType[] = ['white', 'blue', 'green', 'red', 'black'];

// Which sound each action plays when you take it.
const SFX_FOR: Record<Action['type'], Sfx> = {
  TAKE_THREE: 'take', TAKE_TWO: 'take', RESERVE: 'reserve', BUY: 'buy',
  DISCARD: 'click', CHOOSE_NOBLE: 'noble', PASS: 'click',
};

function canAffordClient(p: ClientPlayer, card: Card): boolean {
  let goldNeeded = 0;
  for (const g of GEM_ORDER) {
    const need = Math.max(0, card.cost[g] - p.bonuses[g]);
    goldNeeded += need - Math.min(need, p.tokens[g]);
  }
  return goldNeeded <= p.tokens.gold;
}

/** What it takes to recruit `card` right now, from `p`'s point of view.
 *  `pips` is the per-colour price after permanent bonuses (met = already covered by
 *  held tokens); `need` is the total extra energy still to gather once gold (wild)
 *  is applied — 0 exactly when the card is affordable. */
function reservedNeed(p: ClientPlayer, card: Card): {
  pips: { g: GemType; n: number; met: boolean }[];
  need: number;
} {
  const pips: { g: GemType; n: number; met: boolean }[] = [];
  let short = 0;
  for (const g of GEM_ORDER) {
    const n = Math.max(0, card.cost[g] - p.bonuses[g]); // price after permanent discounts
    if (n > 0) pips.push({ g, n, met: p.tokens[g] >= n });
    short += Math.max(0, n - p.tokens[g]); // colour tokens still missing (before gold)
  }
  return { pips, need: Math.max(0, short - p.tokens.gold) };
}

export function Game({
  state, onAction, onRematch, onLobby,
}: {
  state: ClientState;
  onAction: (a: Action) => void;
  onRematch: () => void;
  onLobby: () => void;
}) {
  const { t } = useLang();
  const you = state.players.find((p) => p.isYou)!;
  const yourTurn = state.status === 'playing' && state.current === state.yourIndex;
  const current = state.players[state.current];

  const [picks, setPicks] = useState<GemType[]>([]);
  const [doublePick, setDoublePick] = useState<GemType | null>(null);
  const [discard, setDiscard] = useState<Record<TokenType, number>>(emptyCounts());

  // Reset transient selections whenever the turn or phase changes.
  useEffect(() => {
    setPicks([]);
    setDoublePick(null);
  }, [state.current, state.turnCount, state.status, state.pendingDiscard, state.pendingNobles.length]);
  useEffect(() => { setDiscard(emptyCounts()); }, [state.pendingDiscard, state.current]);

  // Chime when it becomes your turn (rising edge only, not on every re-render).
  const wasYourTurn = useRef(false);
  useEffect(() => {
    if (yourTurn && !wasYourTurn.current) playSfx('turn');
    wasYourTurn.current = yourTurn;
  }, [yourTurn]);

  // Victory / defeat jingle once the game ends. Reset on a new game so a rematch
  // (the component stays mounted) plays it again.
  const endPlayed = useRef(false);
  useEffect(() => {
    if (state.status !== 'finished') { endPlayed.current = false; return; }
    if (endPlayed.current) return;
    endPlayed.current = true;
    playSfx(state.winnerId === you.id ? 'win' : 'lose');
  }, [state.status, state.winnerId, you.id]);

  const blocked = yourTurn && (state.pendingDiscard > 0 || state.pendingNobles.length > 0);
  const canAct = yourTurn && !blocked;

  const availableColors = GEM_ORDER.filter((g) => state.bank[g] > 0);
  const takeThreeValid =
    picks.length > 0 && (picks.length === 3 || picks.length === availableColors.length);
  const takeTwoValid = doublePick !== null && state.bank[doublePick] >= 4;

  function togglePick(g: GemType) {
    if (!canAct) return;
    setDoublePick(null);
    setPicks((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : prev.length >= 3 ? prev : [...prev, g],
    );
  }

  function toggleDoublePick(g: GemType) {
    if (!canAct || state.bank[g] < 4) return;
    setPicks([]);
    setDoublePick((prev) => prev === g ? null : g);
  }

  function takeEnergy() {
    if (!canAct) return;
    if (doublePick !== null) {
      if (takeTwoValid) send({ type: 'TAKE_TWO', gem: doublePick });
    } else if (takeThreeValid) {
      send({ type: 'TAKE_THREE', gems: picks });
    }
  }

  function send(a: Action) {
    setPicks([]);
    setDoublePick(null);
    playSfx(SFX_FOR[a.type]);
    onAction(a);
  }

  const discardTotal = Object.values(discard).reduce((s, n) => s + n, 0);

  return (
    <div className="game">
      <TurnBanner state={state} current={current} yourTurn={yourTurn} />

      <div className="game-grid">
        {/* ── Board ── */}
        <div className="board">
          <div className="nobles">
            {state.nobles.map((n) => (
              <NobleView key={n.id} name={n.name} req={n.requirement} />
            ))}
            {state.nobles.length === 0 && <div className="nobles-empty">{t('nobles_empty')}</div>}
          </div>

          {[3, 2, 1].map((tier) => (
            <div className={`tier-row tier-${tier}`} key={tier}>
              <DeckBack
                tier={tier as 1 | 2 | 3}
                count={state.deckCounts[tier as 1 | 2 | 3]}
                canReserve={canAct && you.reservedCount < 3 && state.deckCounts[tier as 1 | 2 | 3] > 0}
                onReserve={() => send({ type: 'RESERVE', deckTier: tier as 1 | 2 | 3 })}
              />
              <div className="tier-cards">
                {state.board[tier as 1 | 2 | 3].map((card, i) =>
                  card ? (
                    <CardView
                      key={card.id}
                      card={card}
                      affordable={canAffordClient(you, card)}
                      canBuy={canAct}
                      canReserve={canAct && you.reservedCount < 3}
                      onBuy={() => send({ type: 'BUY', cardId: card.id })}
                      onReserve={() => send({ type: 'RESERVE', cardId: card.id })}
                    />
                  ) : (
                    <div className="card empty-slot" key={`empty-${tier}-${i}`} />
                  ),
                )}
              </div>
            </div>
          ))}

          {/* ── Bank / take actions ── */}
          <div className="bank">
            <div className="bank-label">{t('bank_label')}</div>
            <div className="bank-tokens">
              {GEM_TYPES.map((g) => (
                <div className="bank-col" key={g}>
                  <Token
                    type={g}
                    count={state.bank[g]}
                    size="lg"
                    selected={picks.includes(g) || doublePick === g}
                    dim={state.bank[g] === 0}
                    onClick={canAct && state.bank[g] > 0 ? () => togglePick(g) : undefined}
                    title={t('gem_' + g)}
                  />
                  <button
                    className="take2"
                    aria-pressed={doublePick === g}
                    disabled={!canAct || state.bank[g] < 4}
                    onClick={() => toggleDoublePick(g)}
                    title={t('bank_take2title')}
                  >
                    +2
                  </button>
                </div>
              ))}
              <div className="bank-col gold-col">
                <Token type="gold" count={state.bank.gold} size="lg" title={t('gem_gold')} />
                <span className="gold-note">{t('bank_reserveOnly')}</span>
              </div>
            </div>

            <div className="take-bar">
              <div className="picks">
                {doublePick !== null ? (
                  <Token type={doublePick} count={2} size="sm" onClick={() => toggleDoublePick(doublePick)} title={t('gem_' + doublePick)} />
                ) : picks.length === 0 ? (
                  <span className="picks-hint">{canAct ? t('bank_pickHint') : ''}</span>
                ) : (
                  picks.map((g) => <Token key={g} type={g} size="sm" onClick={() => togglePick(g)} />)
                )}
              </div>
              <button className="btn primary" disabled={!canAct || !(doublePick !== null ? takeTwoValid : takeThreeValid)} onClick={takeEnergy}>
                {t('bank_take')}
              </button>
            </div>
            {canAct && state.currentNoMoves && (
              <div className="no-moves">
                <span>{t('nomoves_text')}</span>
                <button className="btn" onClick={() => send({ type: 'PASS' })}>{t('nomoves_pass')}</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="sidebar">
          <div className="players">
            {state.players.map((p, i) => (
              <PlayerPanel
                key={p.id}
                p={p}
                active={i === state.current && state.status === 'playing'}
                isHost={p.id === state.hostId}
                canBuyReserved={p.isYou && canAct}
                onBuyReserved={(cardId) => send({ type: 'BUY', cardId })}
              />
            ))}
          </div>
          <LogPanel log={state.log} />
        </div>
      </div>

      {/* ── Forced sub-decisions ── */}
      {yourTurn && state.pendingDiscard > 0 && (
        <Modal title={t('discard_title', { n: state.pendingDiscard })} subtitle={t('discard_sub')}>
          <div className="discard-grid">
            {([...GEM_TYPES, 'gold'] as TokenType[]).map((t) => (
              <div className="discard-col" key={t}>
                <Token type={t} count={you.tokens[t]} size="md" />
                <div className="stepper">
                  <button disabled={discard[t] <= 0} onClick={() => setDiscard((d) => ({ ...d, [t]: d[t] - 1 }))}>−</button>
                  <span>{discard[t]}</span>
                  <button
                    disabled={discard[t] >= you.tokens[t] || discardTotal >= state.pendingDiscard}
                    onClick={() => setDiscard((d) => ({ ...d, [t]: d[t] + 1 }))}
                  >+</button>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={discardTotal !== state.pendingDiscard}
            onClick={() => send({ type: 'DISCARD', tokens: discard })}
          >
            {t('discard_btn', { a: discardTotal, b: state.pendingDiscard })}
          </button>
        </Modal>
      )}

      {yourTurn && state.pendingNobles.length > 0 && (
        <Modal title={t('noble_title')} subtitle={t('noble_sub')}>
          <div className="noble-choice">
            {state.pendingNobles.map((n) => (
              <button key={n.id} className="noble-pick" onClick={() => send({ type: 'CHOOSE_NOBLE', nobleId: n.id })}>
                <NobleView name={n.name} req={n.requirement} />
              </button>
            ))}
          </div>
        </Modal>
      )}

      {state.status === 'finished' && (
        <GameOver state={state} youHost={state.hostId === you.id} onRematch={onRematch} onLobby={onLobby} />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TurnBanner({ state, current, yourTurn }: { state: ClientState; current: ClientPlayer; yourTurn: boolean }) {
  const { t } = useLang();
  let msg: string;
  if (state.status === 'finished') msg = t('turn_gameover');
  else if (yourTurn && state.pendingDiscard > 0) msg = t('turn_return', { n: state.pendingDiscard });
  else if (yourTurn && state.pendingNobles.length > 0) msg = t('turn_noble');
  else if (yourTurn && state.currentNoMoves) msg = t('turn_nomoves');
  else if (yourTurn) msg = t('turn_yours');
  else msg = t('turn_other', { name: current.name });
  return (
    <div className={`turn-banner ${yourTurn ? 'mine' : ''}`}>
      <span className="dot" /> {msg}
    </div>
  );
}

function DeckBack({ tier, count, canReserve, onReserve }: { tier: 1 | 2 | 3; count: number; canReserve: boolean; onReserve: () => void }) {
  const { t } = useLang();
  return (
    <button
      className={`deck tier-${tier} ${canReserve ? 'reservable' : ''}`}
      disabled={!canReserve}
      onClick={onReserve}
      title={canReserve ? t('deck_reserveTitle') : t('deck_title', { tier })}
    >
      <span className="deck-tier">T{tier}</span>
      <span className="deck-count">{count}</span>
      {canReserve && <span className="deck-hint">{t('deck_reserve')}</span>}
    </button>
  );
}

function NobleView({ name, req }: { name: string; req: Record<GemType, number> }) {
  const { lang } = useLang();
  return (
    <div className="noble">
      <div className="noble-pts">3</div>
      <div className="noble-name">{localizeNoble(lang, name)}</div>
      <div className="noble-req">
        {GEM_ORDER.filter((g) => req[g] > 0).map((g) => (
          <span className="nreq" key={g} style={{ ['--tk' as string]: GEM_THEME[g].color }}>
            {req[g]}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlayerPanel({
  p, active, isHost, canBuyReserved, onBuyReserved,
}: {
  p: ClientPlayer;
  active: boolean;
  isHost: boolean;
  canBuyReserved: boolean;
  onBuyReserved: (cardId: string) => void;
}) {
  const { lang, t } = useLang();
  const tokenTotal = (['white', 'blue', 'green', 'red', 'black', 'gold'] as TokenType[]).reduce(
    (s, tk) => s + p.tokens[tk], 0,
  );
  return (
    <div className={`player ${active ? 'active' : ''} ${p.connected ? '' : 'offline'} ${p.isAI ? 'ai' : ''}`}>
      <div className="player-top">
        <span className="player-name">
          {p.name}{p.isYou && <em>{t('lobby_you')}</em>}{isHost && <span className="host-badge sm">{t('lobby_host')}</span>}
        </span>
        <span className="player-score">{p.points} ⭐</span>
      </div>
      <div className="player-stats">
        {GEM_ORDER.map((g) => (
          <span className="stat" key={g} style={{ ['--tk' as string]: GEM_THEME[g].color }} title={t('gem_' + g)}>
            <b>{p.bonuses[g]}</b>
            <i>{p.tokens[g]}</i>
          </span>
        ))}
        <span className="stat gold" title={t('gem_gold')}>
          <b>·</b><i>{p.tokens.gold}</i>
        </span>
      </div>
      <div className="player-meta">
        <span>🃏 {p.purchased.length}</span>
        <span>👑 {p.nobles.length}</span>
        <span>⚡ {tokenTotal}/10</span>
        <span>📥 {p.reservedCount}/3</span>
      </div>
      {p.reserved.length > 0 && (
        <div className="reserved-row">
          {p.reserved.map((c) =>
            'hidden' in c ? (
              <div className="mini-card facedown" key={c.id} title={t('deck_title', { tier: c.tier })}>?</div>
            ) : (
              <ReservedCard key={c.id} card={c} p={p} canBuy={canBuyReserved} onBuy={onBuyReserved} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A player's own reserved card, showing at a glance the energy still needed to recruit it. */
function ReservedCard({
  card, p, canBuy, onBuy,
}: {
  card: Card;
  p: ClientPlayer;
  canBuy: boolean;
  onBuy: (cardId: string) => void;
}) {
  const { lang, t } = useLang();
  const { pips, need } = reservedNeed(p, card);
  const afford = need === 0;
  return (
    <button
      className={`mini-card ${afford ? 'afford' : ''}`}
      style={{ ['--bonus' as string]: GEM_THEME[card.bonus].color }}
      disabled={!canBuy || !afford}
      onClick={() => onBuy(card.id)}
      title={afford ? t('reserved_ready', { name: localizeCard(lang, card.name) }) : t('reserved_need', { n: need })}
    >
      <span className="mc-pts">{card.points || ''}</span>
      {afford
        ? <span className="mc-need ready" aria-label={t('reserved_ready', { name: localizeCard(lang, card.name) })}>✓</span>
        : <span className="mc-need">⚡{need}</span>}
      <Sprite name={card.name} bonus={card.bonus} className="mc-sprite" />
      <span className="mc-name">{localizeCard(lang, card.name)}</span>
      <span className="mc-cost">
        {pips.map(({ g, n, met }) => (
          <CostPip key={g} gem={g} n={n} muted={met} />
        ))}
      </span>
    </button>
  );
}

function LogPanel({ log }: { log: ClientState['log'] }) {
  const { lang, t } = useLang();
  const recent = log.map((e, idx) => ({ e, idx })).slice(-12).reverse();
  return (
    <div className="log">
      <div className="log-title">{t('log_title')}</div>
      <div className="log-lines">
        {recent.map(({ e, idx }) => (
          <div className="log-line" key={idx}>{formatLog(e, lang, t)}</div>
        ))}
      </div>
    </div>
  );
}

function Modal({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{title}</h2>
        {subtitle && <p className="modal-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function GameOver({
  state, youHost, onRematch, onLobby,
}: {
  state: ClientState;
  youHost: boolean;
  onRematch: () => void;
  onLobby: () => void;
}) {
  const { t } = useLang();
  const ranked = [...state.players].sort(
    (a, b) => b.points - a.points || a.purchased.length - b.purchased.length,
  );
  const winner = state.players.find((p) => p.id === state.winnerId);
  // If the host left, let any remaining player control the rematch so no one is stuck.
  const hostPlayer = state.players.find((p) => p.id === state.hostId);
  const canControl = youHost || (hostPlayer ? !hostPlayer.connected : true);
  return (
    <div className="modal-backdrop">
      <div className="modal gameover">
        <div className="trophy">🏆</div>
        <h2>{winner ? t('go_champion', { name: winner.name }) : t('go_over')}</h2>
        <div className="final-scores">
          {ranked.map((p, i) => (
            <div className={`final-row ${p.id === state.winnerId ? 'win' : ''}`} key={p.id}>
              <span className="rank">{i + 1}</span>
              <span className="fname">{p.name}{p.isYou && <em>{t('lobby_you')}</em>}</span>
              <span className="fpts">{p.points} ⭐</span>
              <span className="fmeta">{p.purchased.length} 🃏 · {p.nobles.length} 👑</span>
            </div>
          ))}
        </div>
        {canControl ? (
          <div className="go-actions">
            <button className="btn primary" onClick={onRematch}>{t('go_rematch')}</button>
            <button className="btn ghost" onClick={onLobby}>{t('go_backLobby')}</button>
          </div>
        ) : (
          <p className="waiting">{t('go_waitingRematch')}</p>
        )}
      </div>
    </div>
  );
}

function emptyCounts(): Record<TokenType, number> {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}
