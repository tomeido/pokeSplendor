import { useState } from 'react';
import type { Card, GemType, TokenType } from '../../shared/types.ts';
import { GEM_THEME, GOLD_THEME, spriteUrl } from '../../shared/data.ts';
import { localizeCard, useLang } from '../i18n.tsx';

/** A Pokémon sprite that falls back to the energy-type icon if the image is missing. */
export function Sprite({ name, bonus, className = 'card-sprite' }: { name: string; bonus: GemType; className?: string }) {
  const [err, setErr] = useState(false);
  const url = spriteUrl(name);
  if (!url || err) return <span className={`${className} sprite-fallback`}>{GEM_THEME[bonus].icon}</span>;
  return <img className={className} src={url} alt={name} loading="lazy" draggable={false} onError={() => setErr(true)} />;
}

export function themeOf(t: TokenType) {
  return t === 'gold' ? GOLD_THEME : GEM_THEME[t];
}

export function Token({
  type, count, size = 'md', selected, dim, onClick, title,
}: {
  type: TokenType;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const th = themeOf(type);
  return (
    <button
      type="button"
      className={`token token-${size} ${selected ? 'sel' : ''} ${dim ? 'dim' : ''} ${onClick ? 'clickable' : 'static'}`}
      style={{ ['--tk' as string]: th.color }}
      onClick={onClick}
      disabled={!onClick}
      title={title ?? th.label}
    >
      <span className="token-icon">{th.icon}</span>
      {count != null && <span className="token-count">{count}</span>}
    </button>
  );
}

/** A small coloured pip showing a single cost requirement. */
function CostPip({ gem, n }: { gem: GemType; n: number }) {
  const th = GEM_THEME[gem];
  return (
    <span className="pip" style={{ ['--tk' as string]: th.color }}>
      <span className="pip-icon">{th.icon}</span>
      <span className="pip-n">{n}</span>
    </span>
  );
}

const GEM_ORDER: GemType[] = ['white', 'blue', 'green', 'red', 'black'];

export function CardView({
  card, faceDown, tierLabel, affordable, canBuy, canReserve, onBuy, onReserve,
}: {
  card?: Card;
  faceDown?: boolean;
  tierLabel?: number;
  affordable?: boolean;
  canBuy?: boolean;
  canReserve?: boolean;
  onBuy?: () => void;
  onReserve?: () => void;
}) {
  const { lang, t } = useLang();
  if (faceDown || !card) {
    return (
      <div className={`card facedown tier-${tierLabel ?? 1}`}>
        <div className="card-back">
          <span className="back-ball" />
          {tierLabel && <span className="back-tier">Tier {tierLabel}</span>}
        </div>
      </div>
    );
  }

  const th = GEM_THEME[card.bonus];
  return (
    <div
      className={`card tier-${card.tier} ${affordable ? 'affordable' : ''}`}
      style={{ ['--bonus' as string]: th.color }}
    >
      <div className="card-head">
        <span className="card-points">{card.points > 0 ? card.points : ''}</span>
        <span className="card-bonus" title={`${th.label} energy`}>{th.icon}</span>
      </div>
      <div className="card-art"><Sprite name={card.name} bonus={card.bonus} /></div>
      <div className="card-name">{localizeCard(lang, card.name)}</div>
      <div className="card-cost">
        {GEM_ORDER.filter((g) => card.cost[g] > 0).map((g) => (
          <CostPip key={g} gem={g} n={card.cost[g]} />
        ))}
      </div>
      {(canBuy || canReserve) && (
        <div className="card-actions">
          {canBuy && (
            <button className={`mini ${affordable ? 'buy' : ''}`} disabled={!affordable} onClick={onBuy}>
              {t('card_recruit')}
            </button>
          )}
          {canReserve && (
            <button className="mini reserve" onClick={onReserve} title={t('card_reserveTitle')}>
              {t('card_reserve')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
