import { useState } from 'react';
import { useLang } from '../i18n.tsx';

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function Home({ defaultName, onJoin }: { defaultName: string; onJoin: (roomId: string, name: string) => void }) {
  const { t } = useLang();
  const urlRoom = new URLSearchParams(window.location.search).get('room') || '';
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState(urlRoom.toUpperCase());

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0;
  const canJoin = trimmedName.length > 0 && code.trim().length >= 3;

  return (
    <div className="home">
      <div className="home-card">
        <h1>{t('home_title')}</h1>
        <p className="sub">{t('home_sub')}</p>

        <label className="field">
          <span>{t('home_nameLabel')}</span>
          <input
            value={name}
            maxLength={16}
            placeholder={t('home_namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="home-actions">
          <button className="btn primary" disabled={!canCreate} onClick={() => onJoin(randomCode(), trimmedName)}>
            {t('home_create')}
          </button>
          <div className="or">{t('home_or')}</div>
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder={t('home_codePlaceholder')}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn" disabled={!canJoin} onClick={() => onJoin(code.trim(), trimmedName)}>
              {t('home_join')}
            </button>
          </div>
        </div>

        <details className="rules">
          <summary>{t('home_howto')}</summary>
          <ul>
            <li>{t('rule1')}</li>
            <li>{t('rule2')}</li>
            <li>{t('rule3')}</li>
            <li>{t('rule4')}</li>
            <li>{t('rule5')}</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
