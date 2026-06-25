import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { GemType, LogEntry } from '../shared/types.ts';

export type Lang = 'en' | 'ko';
const LANG_KEY = 'poke-splendor-lang';

export function getSavedLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY) as Lang | null;
  if (saved === 'en' || saved === 'ko') return saved;
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

type P = Record<string, any>;
type Entry = string | ((p: P) => string);

// ── Korean Pokémon names (English key → 한국어). Missing entries fall back to English. ──
const KO_NAME: Record<string, string> = {
  // Fairy
  Igglybuff: '푸푸린', Cleffa: '삐', Snubbull: '블루', Ralts: '랄토스', Spritzee: '슈쁘', Flabébé: '플라베베', Swirlix: '나룸퍼프', Cutiefly: '에블리',
  Jigglypuff: '푸린', Clefairy: '삐삐', Granbull: '그랑블루', Kirlia: '킬리아', Aromatisse: '프레프티르',
  Wigglytuff: '푸크린', Clefable: '픽시', Gardevoir: '가디안', Sylveon: '님피아',
  // Water
  Squirtle: '꼬부기', Magikarp: '잉어킹', Psyduck: '고라파덕', Poliwag: '발챙이', Horsea: '쏘드라', Staryu: '별가사리', Tentacool: '왕눈해', Krabby: '크랩',
  Wartortle: '어니부기', Gyarados: '갸라도스', Golduck: '골덕', Poliwhirl: '슈륙챙이', Seadra: '시드라',
  Blastoise: '거북왕', Vaporeon: '샤미드', Lapras: '라프라스', Kingdra: '킹드라',
  // Grass
  Bulbasaur: '이상해씨', Oddish: '뚜벅쵸', Bellsprout: '모다피', Chikorita: '치코리타', Treecko: '나무지기', Hoppip: '통통코', Sunkern: '해너츠', Seedot: '도토링',
  Ivysaur: '이상해풀', Gloom: '냄새꼬', Weepinbell: '우츠동', Bayleef: '베이리프', Grovyle: '나무돌이',
  Venusaur: '이상해꽃', Vileplume: '라플레시아', Victreebel: '우츠보트', Sceptile: '나무킹',
  // Fire
  Charmander: '파이리', Vulpix: '식스테일', Growlithe: '가디', Ponyta: '포니타', Cyndaquil: '브케인', Slugma: '마그마그', Torchic: '아차모', Litwick: '불켜미',
  Charmeleon: '리자드', Ninetales: '나인테일', Arcanine: '윈디', Rapidash: '날쌩마', Quilava: '마그케인',
  Charizard: '리자몽', Flareon: '부스터', Typhlosion: '블레이범', Magmortar: '마그마번',
  // Dark
  Poochyena: '포챠나', Houndour: '델빌', Sneasel: '포푸니', Murkrow: '니로우', Zorua: '조로아', Purrloin: '쌔비냥', Nickit: '훔처우', Impidimp: '메롱꿍',
  Mightyena: '그라에나', Houndoom: '헬가', Weavile: '포푸니라', Honchkrow: '돈크로우', Zoroark: '조로아크',
  Tyranitar: '마기라스', Umbreon: '블래키', Absol: '앱솔', Hydreigon: '삼삼드래',
};

// ── Gym Leaders / Champions (English → 한국어) ──
const KO_NOBLE: Record<string, string> = {
  Brock: '웅', Misty: '이슬', 'Lt. Surge': '마티스', Erika: '민화', Koga: '독수',
  Sabrina: '초련', Blaine: '강연', Giovanni: '비주기', Lance: '목호', Cynthia: '난천',
};

export function localizeCard(lang: Lang, en: string): string {
  return lang === 'ko' ? KO_NAME[en] ?? en : en;
}
export function localizeNoble(lang: Lang, en: string): string {
  return lang === 'ko' ? KO_NOBLE[en] ?? en : en;
}

const STRINGS: Record<Lang, Record<string, Entry>> = {
  en: {
    tagline: 'Pokémon Edition',
    conn_online: 'online', conn_connecting: 'connecting…',
    // Home
    home_title: 'Catch the gems. Become Champion.',
    home_sub: 'A faithful online version of Splendor, reskinned with Pokémon. Race to 15 points by collecting energy and recruiting Pokémon. Play with 2–4 friends — or solo against the computer.',
    home_nameLabel: 'Your trainer name', home_namePlaceholder: 'Ash',
    home_create: 'Create a room', home_or: 'or', home_codePlaceholder: 'ROOM CODE', home_join: 'Join',
    home_howto: 'How to play',
    rule1: 'On your turn pick one action: take 3 different energy, take 2 of one energy (4+ in bank), reserve a Pokémon (+1 ⚡ wild), or recruit (buy) a Pokémon.',
    rule2: 'Recruited Pokémon give a permanent energy discount and sometimes points.',
    rule3: "Match a Gym Leader's energy requirement and they join you for 3 points — automatically.",
    rule4: 'Hold at most 10 energy tokens and 3 reserved Pokémon.',
    rule5: 'First to 15 points triggers the final round. Highest score wins.',
    // Lobby
    lobby_roomCode: 'Room code', lobby_copyLink: 'Copy link', lobby_copied: 'Copied!',
    lobby_shareHint: 'Send the link or code to friends so they can join. Up to 4 players.',
    lobby_waiting: 'waiting…', lobby_host: 'HOST', lobby_you: ' (you)',
    lobby_addAI: '+ Add computer', lobby_removeAI: '− Remove computer',
    lobby_start: (p) => `Start game (${p.n})`, lobby_need: 'Need 2+ players',
    lobby_leave: 'Leave', lobby_waitingHost: 'Waiting for the host to start…',
    lobby_solo: 'Add a computer to play solo →',
    // Turn banner
    turn_gameover: 'Game over',
    turn_return: (p) => `Return ${p.n} energy`, turn_noble: 'Choose a Gym Leader',
    turn_nomoves: 'No moves — you must pass', turn_yours: 'Your turn — make a move',
    turn_other: (p) => `${p.name}'s turn`,
    // Board
    nobles_empty: 'All Gym Leaders recruited',
    bank_label: 'Energy bank', bank_pickHint: 'Pick up to 3 different energy, or use +2.',
    bank_take: 'Take energy', bank_take2title: 'Take 2 of this energy (needs 4+ in bank)',
    bank_reserveOnly: 'reserve only',
    card_recruit: 'Recruit', card_reserve: 'Reserve', card_reserveTitle: 'Reserve (+1 ⚡)',
    deck_reserveTitle: 'Reserve the top card (blind) +1 ⚡', deck_title: (p) => `Tier ${p.tier} deck`, deck_reserve: 'reserve',
    nomoves_text: 'No moves available (bank empty, reserves full, nothing affordable).', nomoves_pass: 'Pass turn',
    log_title: 'Battle log',
    // Modals
    discard_title: (p) => `Return ${p.n} energy`, discard_sub: 'You can hold at most 10 tokens.',
    discard_btn: (p) => `Return ${p.a}/${p.b}`,
    noble_title: 'A Gym Leader wants to join!', noble_sub: 'Choose which one visits you (+3 ⭐).',
    go_champion: (p) => `${p.name} is the Champion!`, go_over: 'Game over',
    go_rematch: 'Rematch', go_backLobby: 'Back to lobby', go_waitingRematch: 'Waiting for the host to start a rematch…',
    // Gems
    gem_white: 'Fairy', gem_blue: 'Water', gem_green: 'Grass', gem_red: 'Fire', gem_black: 'Dark', gem_gold: 'Electric',
    // Log
    log_start: (p) => `Game started with ${p.names}. ${p.first} goes first!`,
    log_take3: (p) => `${p.name} took ${p.gems}.`,
    log_take2: (p) => `${p.name} took 2 ${p.gem}.`,
    log_reserve: (p) => `${p.name} reserved a Tier ${p.tier} card.`,
    log_buy: (p) => `${p.name} recruited ${p.card} (${p.bonus}${p.pts ? `, +${p.pts}⭐` : ''}).`,
    log_overcap: (p) => `${p.name} must return ${p.n} token(s).`,
    log_returned: (p) => `${p.name} returned ${p.n} token(s).`,
    log_noble: (p) => `${p.name} attracted ${p.noble} (+3 ⭐).`,
    log_pass: (p) => `${p.name} has no legal move and passes.`,
    log_win: (p) => `🏆 ${p.name} wins with ${p.pts} points!`,
  },
  ko: {
    tagline: '포켓몬 에디션',
    conn_online: '온라인', conn_connecting: '연결 중…',
    home_title: '에너지를 모아 챔피언이 되세요!',
    home_sub: '보드게임 스플렌더를 포켓몬 테마로 재구성한 온라인 버전입니다. 에너지를 모으고 포켓몬을 영입해 15점에 먼저 도달하세요. 친구 2~4명과, 또는 혼자 컴퓨터와 즐기세요.',
    home_nameLabel: '트레이너 이름', home_namePlaceholder: '지우',
    home_create: '방 만들기', home_or: '또는', home_codePlaceholder: '방 코드', home_join: '참가',
    home_howto: '게임 방법',
    rule1: '자기 차례에 한 가지 행동을 선택하세요: 서로 다른 에너지 3개 획득 / 같은 에너지 2개 획득(은행에 4개 이상) / 포켓몬 예약(+1 ⚡ 와일드) / 포켓몬 영입(구매).',
    rule2: '영입한 포켓몬은 영구 에너지 할인과 때때로 점수를 줍니다.',
    rule3: '체육관 관장의 에너지 조건을 충족하면 자동으로 합류해 3점을 줍니다.',
    rule4: '에너지 토큰은 최대 10개, 예약 포켓몬은 최대 3장까지 보유할 수 있습니다.',
    rule5: '먼저 15점에 도달하면 마지막 라운드가 시작되고, 최고 점수가 승리합니다.',
    lobby_roomCode: '방 코드', lobby_copyLink: '링크 복사', lobby_copied: '복사됨!',
    lobby_shareHint: '친구에게 링크나 코드를 보내 참가시키세요. 최대 4명.',
    lobby_waiting: '대기 중…', lobby_host: '방장', lobby_you: ' (나)',
    lobby_addAI: '+ 컴퓨터 추가', lobby_removeAI: '− 컴퓨터 제거',
    lobby_start: (p) => `게임 시작 (${p.n})`, lobby_need: '2명 이상 필요',
    lobby_leave: '나가기', lobby_waitingHost: '방장이 시작하기를 기다리는 중…',
    lobby_solo: '컴퓨터를 추가하면 혼자서도 즐길 수 있어요 →',
    turn_gameover: '게임 종료',
    turn_return: (p) => `에너지 ${p.n}개 반납`, turn_noble: '체육관 관장 선택',
    turn_nomoves: '행동 불가 — 패스해야 합니다', turn_yours: '당신 차례 — 행동하세요',
    turn_other: (p) => `${p.name}의 차례`,
    nobles_empty: '모든 관장 영입 완료',
    bank_label: '에너지 은행', bank_pickHint: '서로 다른 에너지 3개를 고르거나, +2를 누르세요.',
    bank_take: '에너지 획득', bank_take2title: '이 에너지 2개 획득 (은행에 4개 이상 필요)',
    bank_reserveOnly: '예약 전용',
    card_recruit: '영입', card_reserve: '예약', card_reserveTitle: '예약 (+1 ⚡)',
    deck_reserveTitle: '맨 위 카드 예약(비공개) +1 ⚡', deck_title: (p) => `${p.tier}티어 덱`, deck_reserve: '예약',
    nomoves_text: '할 수 있는 행동이 없습니다 (은행이 비었고, 예약이 가득 찼으며, 살 수 있는 카드가 없음).', nomoves_pass: '턴 넘기기',
    log_title: '배틀 로그',
    discard_title: (p) => `에너지 ${p.n}개 반납`, discard_sub: '토큰은 최대 10개까지 보유할 수 있습니다.',
    discard_btn: (p) => `${p.a}/${p.b} 반납`,
    noble_title: '체육관 관장이 합류하려 합니다!', noble_sub: '함께할 관장을 고르세요 (+3 ⭐).',
    go_champion: (p) => `${p.name} 챔피언 등극!`, go_over: '게임 종료',
    go_rematch: '다시 하기', go_backLobby: '로비로', go_waitingRematch: '방장이 다시 시작하기를 기다리는 중…',
    gem_white: '페어리', gem_blue: '물', gem_green: '풀', gem_red: '불꽃', gem_black: '악', gem_gold: '전기',
    log_start: (p) => `${p.names} 게임 시작! ${p.first}부터 시작합니다.`,
    log_take3: (p) => `${p.name}: ${p.gems} 획득.`,
    log_take2: (p) => `${p.name}: ${p.gem} 2개 획득.`,
    log_reserve: (p) => `${p.name}: ${p.tier}티어 카드 예약.`,
    log_buy: (p) => `${p.name}: ${p.card} 영입 (${p.bonus}${p.pts ? `, +${p.pts}⭐` : ''}).`,
    log_overcap: (p) => `${p.name}: 토큰 ${p.n}개를 반납해야 합니다.`,
    log_returned: (p) => `${p.name}: 토큰 ${p.n}개 반납.`,
    log_noble: (p) => `${p.name}: ${p.noble} 영입 (+3 ⭐).`,
    log_pass: (p) => `${p.name}: 행동 불가로 패스.`,
    log_win: (p) => `🏆 ${p.name} 승리! (${p.pts}점)`,
  },
};

export type T = (key: string, params?: P) => string;

export function makeT(lang: Lang): T {
  return (key, params) => {
    const e = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
    return typeof e === 'function' ? e(params ?? {}) : e;
  };
}

/** Render a structured log entry in the chosen language. */
export function formatLog(e: LogEntry, lang: Lang, t: T): string {
  const gl = (g: GemType) => t('gem_' + g);
  switch (e.k) {
    case 'start': return t('log_start', { names: e.names.join(', '), first: e.first });
    case 'take3': return t('log_take3', { name: e.name, gems: e.gems.map(gl).join(', ') });
    case 'take2': return t('log_take2', { name: e.name, gem: gl(e.gem) });
    case 'reserve': return t('log_reserve', { name: e.name, tier: e.tier });
    case 'buy': return t('log_buy', { name: e.name, card: localizeCard(lang, e.card), bonus: gl(e.bonus), pts: e.points });
    case 'overcap': return t('log_overcap', { name: e.name, n: e.n });
    case 'returned': return t('log_returned', { name: e.name, n: e.n });
    case 'noble': return t('log_noble', { name: e.name, noble: localizeNoble(lang, e.noble) });
    case 'pass': return t('log_pass', { name: e.name });
    case 'win': return t('log_win', { name: e.name, pts: e.points });
  }
}

// ── React context ──
interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: T }
const LangContext = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getSavedLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo<LangCtx>(() => ({
    lang,
    setLang: (l) => { localStorage.setItem(LANG_KEY, l); setLangState(l); },
    t: makeT(lang),
  }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangCtx {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
