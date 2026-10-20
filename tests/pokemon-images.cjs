// Run only against an isolated production server built/served under /splendor.
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN;
if (!origin) throw new Error('TEST_ORIGIN must name an isolated test server');
const engine = process.env.TEST_BROWSER || 'chromium';
const base = new URL('/splendor/', origin).href;

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(20);
  }
}

async function assertPokemonCards(page) {
  const cards = page.locator('.board .tier-cards .card');
  assert.equal(await cards.count(), 12, 'all initial market slots must contain a Pokémon');
  assert.equal(await cards.locator('.sprite-fallback').count(), 0, 'Pokémon must not render as type icons');
  assert.equal(await cards.locator('.card-art img').count(), 12, 'every card needs its Pokémon image');
  for (const card of await cards.all()) await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.board .tier-cards .card-art img')];
    return images.length === 12 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  const visible = await cards.evaluateAll((elements) => elements.map((card) => {
    const image = card.querySelector('.card-art img');
    return { name: card.querySelector('.card-name').textContent, src: image.currentSrc,
      width: image.naturalWidth, height: image.naturalHeight };
  }));
  for (const card of visible) {
    assert.match(card.name, /[가-힣]/u, `Korean Pokémon name missing: ${card.name}`);
    assert.match(new URL(card.src).pathname, /^\/splendor\/sprites\/\d+\.png$/);
    assert.ok(card.width > 0 && card.height > 0, `Pokémon image failed to decode: ${card.name}`);
  }
  await cards.locator('.card-art img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
}

(async () => {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(engine === 'chromium' ? {
      args: ['--no-sandbox'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    } : {}),
  });
  const errors = [];
  try {
    for (const mobile of [false, true]) {
      const contexts = [];
      const activate = (locator) => mobile ? locator.tap() : locator.click();
      async function player(name, roomLink) {
        const context = await browser.newContext({
          viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 1000 },
          locale: 'ko-KR', isMobile: mobile, hasTouch: mobile,
        });
        contexts.push(context);
        await context.addInitScript(() => localStorage.setItem('poke-splendor-lang', 'ko'));
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => errors.push(error.message));
        const observed = { page, state: null, upgraded: false };
        page.on('websocket', (socket) => {
          socket.on('framesent', ({ payload }) => {
            if (String(payload) === '5') observed.upgraded = true;
          });
          socket.on('framereceived', ({ payload }) => {
            const packet = String(payload);
            if (!packet.startsWith('42[')) return;
            const [event, data] = JSON.parse(packet.slice(2));
            if (event === 'state') observed.state = data;
            if (event === 'errorMsg') errors.push(data.message);
          });
        });
        const response = await page.goto(roomLink || base);
        assert.match(response.headers()['cache-control'], /\bno-store\b/, 'entry HTML must bypass stale caches');
        await page.locator('.conn.on').waitFor();
        await waitFor(() => observed.upgraded, 'Socket.IO did not upgrade to WebSocket');
        await page.getByLabel('트레이너 이름').fill(name);
        await activate(page.getByRole('button', { name: roomLink ? '참가' : '방 만들기', exact: true }));
        await page.locator('.lobby').waitFor();
        return observed;
      }
      try {
        const first = await player('포켓몬확인1');
        const second = await player('포켓몬확인2', first.page.url());
        await activate(first.page.getByRole('button', { name: '게임 시작 (2)', exact: true }));
        await Promise.all([first.page.locator('.game').waitFor(), second.page.locator('.game').waitFor()]);
        await waitFor(() => first.state && second.state, 'Initial game state missing');
        await Promise.all([assertPokemonCards(first.page), assertPokemonCards(second.page)]);
        console.log(`PASS [${engine}, ${mobile ? 'mobile' : 'desktop'}]: all 12 Pokémon have Korean names and decoded images`);

        const asset = await first.page.locator('script[type="module"][src]').getAttribute('src');
        const api = await first.page.request.get(new URL('api/client-version', base).href);
        assert.equal(api.status(), 200);
        assert.match(api.headers()['cache-control'], /\bno-store\b/);
        assert.deepEqual(await api.json(), { asset });
        const javascript = await first.page.request.get(new URL(asset, origin).href);
        assert.equal(javascript.status(), 200);
        assert.match(javascript.headers()['cache-control'], /\bimmutable\b/, 'hashed bundles should remain cacheable');

        const roomLink = first.page.url();
        const playerId = await first.page.evaluate(() => localStorage.getItem('poke-splendor-pid'));
        const board = structuredClone(first.state.board);
        let versionRequests = 0;
        await first.page.route('**/splendor/api/client-version', (route) => {
          versionRequests++;
          if (versionRequests === 1) {
            return route.fulfill({ json: { asset: '/splendor/assets/version-regression.js' },
              headers: { 'Cache-Control': 'no-store' } });
          }
          return route.continue();
        });
        first.state = null;
        await first.page.evaluate(() => { window.pokemonImageTestMarker = 'before update'; });
        await Promise.all([
          first.page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          first.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
        ]);
        await first.page.locator('.game').waitFor();
        await waitFor(() => first.state, 'Reloaded client did not resume the game');
        assert.ok(versionRequests >= 1, 'restoring a tab must check the deployed version');
        assert.equal(await first.page.evaluate(() => window.pokemonImageTestMarker), undefined, 'outdated client must reload');
        assert.equal(first.page.url(), roomLink, 'automatic update must preserve the room URL');
        assert.equal(await first.page.evaluate(() => localStorage.getItem('poke-splendor-pid')), playerId);
        assert.equal(first.state.youId, playerId, 'automatic update must preserve the player seat');
        assert.equal(first.state.players.length, 2);
        assert.deepEqual(first.state.board, board, 'automatic update must preserve the current game');
        await assertPokemonCards(first.page);
        console.log(`PASS [${engine}, ${mobile ? 'mobile' : 'desktop'}]: version mismatch reloads and preserves the room, seat and Pokémon`);
      } finally {
        for (const context of contexts) await context.close();
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
