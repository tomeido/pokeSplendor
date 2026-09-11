# Splendor: Pokémon Edition — Online Multiplayer

A faithful, online, real-time multiplayer version of **Splendor**, reskinned with Pokémon, so
you can play with 2–4 friends in the browser. Based on the Korea Boardgames Pokémon Splendor
([product page](https://www.koreaboardgames.com/product/detail?prdCd=PD2024002338EAXR)).

- **Energy** (gem tokens) → 5 Pokémon types: ✨ Fairy, 💧 Water, 🍃 Grass, 🔥 Fire, 🌙 Dark, plus ⚡ wild (gold).
- **Development cards** → Pokémon you *recruit* for a permanent energy discount and points.
- **Nobles** → Gym Leaders & Champions (Brock, Misty, Cynthia…) that join you for 3 points.
- First to **15 points** triggers the final round; highest score wins.

**Languages:** English & 한국어 — toggle any time with the EN/한 switch in the top bar (UI, Pokémon names,
Gym Leaders, and the battle log are all localized; the log re-translates retroactively).

**Solo vs computer:** in the lobby, the host can press **+ Add computer** to add AI opponents and play
alone (or fill out a game). The AI runs on the authoritative server and takes its turns automatically.

The full 90-card Splendor deck, 10 nobles, and all official rules are implemented (take 3 different /
take 2 same / reserve +wild / recruit, the 10-token cap, 3-reserve cap, nobles, and last-round scoring).

## Tech

- **Server**: Node + Express + Socket.IO — *authoritative*: it validates every move, so the game
  cannot be cheated from the client. Each player only receives the information they're allowed to see
  (deck order and opponents' reserved cards are hidden).
- **Client**: React + TypeScript + Vite.
- **Shared** rules engine in `shared/` is used by the server and (for types) the client.

## Run it

```bash
npm install        # once

# Development (hot reload): client on :5173, server on :3001
npm run dev
#  → open http://localhost:5173

# Production (single port serves everything)
npm run build
npm start
#  → open http://localhost:3001
```

## Play with friends

1. Run the server (`npm start`, or `npm run dev` for local testing).
2. One person **creates a room** and shares the **room code** or the **link** (the lobby has a Copy link button).
3. Friends open the link / enter the code with their name. Up to 4 players.
4. The host presses **Start game**.

For friends on other networks, expose the single production port to the internet, e.g.:

```bash
npm run build && npm start          # serves on :3001
npx ngrok http 3001                 # share the printed https URL
```

(Any tunnel/host works — Render, Railway, Fly.io, a VPS, etc. Set `PORT` via env if needed.)

Disconnects are handled: rejoin with the same browser to resume your seat mid-game.

## Mobile fullscreen

On a phone in landscape, tap the four-corner icon in the top bar to enter or leave fullscreen.
Android Chrome and Brave can hide their browser controls through the Fullscreen API. In-app browsers
such as KakaoTalk may reject the request because their native toolbar is controlled by the host app;
in that case, open the link in Chrome/Brave and either use the same button or add the game to the Home
screen. The bundled web app manifest requests a fullscreen app window for an installed shortcut,
with the exact system UI still determined by the device and browser.

For iPhone KakaoTalk, first copy the link in the fullscreen guide, then use the bottom-right
**Share → Open in Safari**. **Paste the copied link into Safari's address bar and navigate to it**
to resume your game. Opening Safari from the native Share menu alone does not transfer your seat.
When already in a room, the guide prepares a private, one-time move link (valid for five minutes).
The receiving browser resumes the same seat, cards, score and host role automatically, even with
different browser storage. Use **Copy move link** and paste it into Safari; do not rely on the native
menu forwarding the move information. The old browser loses control; refreshes in the new browser use a
private reconnect key. Existing Safari tabs also detect incoming fragment links and restart with a
fresh connection before claiming the seat. Use the lobby's ordinary room link to invite friends,
not the personal move link.

## How to play (each turn, pick ONE)

| Action | What it does |
| --- | --- |
| **Take 3 energy** | Click up to 3 *different* energy tokens, then **Take energy**. |
| **Take 2 energy** | Press **+2** under a type (needs 4+ in the bank). |
| **Reserve** | Reserve a face-up card or a face-down deck top (**+1 ⚡ wild**). Max 3 reserved. |
| **Recruit** | Buy a card you can afford (board or reserved). Gives a permanent discount + points. |

You can hold at most **10 energy**; over the cap you'll be asked to return some. Match a Gym Leader's
energy requirement and they join you automatically for **3 points**.

## Pokémon sprites

Every card shows a cute Pokémon render. The sprites are bundled locally in `public/sprites/<dex>.png`
so the game needs no external CDN at play time. To re-download / refresh them:

```bash
npm run sprites    # fetches HOME renders for all ~85 Pokémon used in the deck
```

Sprites come from [PokeAPI/sprites](https://github.com/PokeAPI/sprites) (Pokémon © Nintendo / Game Freak —
used here for a personal, non-commercial project).

## Project layout

```
shared/      types.ts, data.ts (deck + Pokémon theme + dex map), engine.ts (rules + AI — authoritative)
server/      index.ts (Socket.IO rooms/lobby/AI), fetch-sprites.ts, *.test.ts, bot.ts, fuzz.ts (dev/test)
src/         React client (App, socket, i18n.tsx, components/)
public/      sprites/ (bundled Pokémon images)
```

## Tests

```bash
npx tsx server/engine.test.ts     # rules engine unit checks
npx tsx server/ai.test.ts         # AI plays only legal moves; AI-only games terminate
npx tsx server/browser-transfer.test.ts # isolated server: cross-browser resume, expiry and replay protection
npx tsx server/fuzz.ts 1000       # 1000 random full games, all invariants checked
# live socket flow (server must be running): PORT=3001 npx tsx server/integration.test.ts
```

With Playwright and its browsers installed, run the browser-transfer navigation regressions
against an **isolated** production build served under `/splendor` (the tests create rooms):

```bash
TEST_ORIGIN=http://localhost:3001 TEST_BROWSER=webkit node tests/browser-transfer-navigation.cjs
TEST_ORIGIN=http://localhost:3001 TEST_BROWSER=chromium node tests/browser-transfer-navigation.cjs
```

`PLAYWRIGHT_PATH` can point to an external Playwright installation and `CHROMIUM_PATH` to a
custom Chromium executable. These tests cover existing Safari tabs after a failed game join,
already-joined lobby tabs, and a simulated BFCache restoration with a newly received link.
