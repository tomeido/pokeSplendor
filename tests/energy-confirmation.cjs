// Run only against an isolated production server built/served under /splendor.
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN;
if (!origin) throw new Error('TEST_ORIGIN must name an isolated test server');
const engine = process.env.TEST_BROWSER || 'chromium';
const gems = ['white', 'blue', 'green', 'red', 'black'];

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(20);
  }
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
        const observed = { page, actions: [], state: null, upgraded: false };
        // Wait for the normal polling -> WebSocket upgrade before joining, so
        // every gameplay action and authoritative state is observed on the wire.
        page.on('websocket', (socket) => {
          socket.on('framesent', ({ payload }) => {
            const packet = String(payload);
            if (packet === '5') observed.upgraded = true;
            if (!packet.startsWith('42[')) return;
            const [event, data] = JSON.parse(packet.slice(2));
            if (event === 'action') observed.actions.push(data.action);
          });
          socket.on('framereceived', ({ payload }) => {
            const packet = String(payload);
            if (!packet.startsWith('42[')) return;
            const [event, data] = JSON.parse(packet.slice(2));
            if (event === 'state') observed.state = data;
            if (event === 'errorMsg') errors.push(data.message);
          });
        });
        await page.goto(roomLink || origin + '/splendor/');
        await page.locator('.conn.on').waitFor();
        await waitFor(() => observed.upgraded, 'Socket.IO did not upgrade to WebSocket');
        await page.getByLabel('트레이너 이름').fill(name);
        await activate(page.getByRole('button', { name: roomLink ? '참가' : '방 만들기', exact: true }));
        await page.locator('.lobby').waitFor();
        return observed;
      }
      try {
        const first = await player('확정테스트1');
        const second = await player('확정테스트2', first.page.url());
        await activate(first.page.getByRole('button', { name: '게임 시작 (2)', exact: true }));
        await Promise.all([first.page.locator('.game').waitFor(), second.page.locator('.game').waitFor()]);
        await waitFor(() => first.state && second.state, 'Initial game state missing');
        const initial = structuredClone(first.state);
        const double = (p, index) => p.page.locator('.take2').nth(index);
        const single = (p, index) => p.page.locator('.bank-col > .token').nth(index);
        const confirm = (p) => p.page.getByRole('button', { name: '에너지 획득', exact: true });
        async function selected(p, index) {
          await p.page.locator('.take2[aria-pressed="true"]').waitFor();
          assert.equal(await double(p, index).getAttribute('aria-pressed'), 'true');
          assert.equal(await p.page.locator('.take2[aria-pressed="true"]').count(), 1);
          assert.equal(await p.page.locator('.picks .token-count').innerText(), '2');
          assert.equal(await confirm(p).isEnabled(), true);
        }
        async function unchanged(p, state, actions = []) {
          // An absent action needs a short observation window, including the
          // synthesized click following a touch event on mobile browsers.
          await delay(150);
          assert.deepEqual(p.actions, actions, 'selection must not send a gameplay action');
          assert.deepEqual(p.state, state, 'selection must not change authoritative game state');
          assert.deepEqual(await p.page.locator('.bank-col > .token .token-count').allTextContents(),
            [...gems, 'gold'].map((gem) => String(state.bank[gem])));
          assert.deepEqual(await p.page.locator('.player-stats .stat i').allTextContents(),
            state.players.flatMap((player) => [...gems, 'gold'].map((gem) => String(player.tokens[gem]))));
        }
        async function disabledTurn(p) {
          assert.equal(await p.page.locator('.take2:disabled').count(), 5);
          assert.equal(await p.page.locator('.bank-col > .token:disabled').count(), 6);
          assert.equal(await confirm(p).isDisabled(), true);
        }
        await disabledTurn(second);
        assert.equal(await confirm(first).isDisabled(), true);

        await activate(double(first, 0));
        await unchanged(first, initial);
        await selected(first, 0);
        await activate(double(first, 0));
        assert.equal(await first.page.locator('.take2[aria-pressed="true"]').count(), 0);
        assert.equal(await confirm(first).isDisabled(), true);
        await unchanged(first, initial);

        await activate(double(first, 0));
        await activate(double(first, 1));
        await selected(first, 1);
        await activate(first.page.locator('.picks .token'));
        assert.equal(await confirm(first).isDisabled(), true);
        await activate(double(first, 1));
        await activate(single(first, 2));
        assert.equal(await first.page.locator('.take2[aria-pressed="true"]').count(), 0);
        assert.equal(await first.page.locator('.picks .token').count(), 1);
        assert.equal(await confirm(first).isDisabled(), true);
        await unchanged(first, initial);
        await activate(double(first, 0));
        await selected(first, 0);
        assert.equal(await first.page.locator('.picks .token').count(), 1);
        await unchanged(first, initial);

        await activate(confirm(first));
        await waitFor(() => first.state.turnCount === initial.turnCount + 1 && second.state.current === 1,
          'Confirming two energy must advance the turn once');
        assert.deepEqual(first.actions, [{ type: 'TAKE_TWO', gem: 'white' }]);
        assert.deepEqual(first.state.bank, { ...initial.bank, white: initial.bank.white - 2 });
        assert.deepEqual(first.state.players[0].tokens, { ...initial.players[0].tokens, white: 2 });
        assert.deepEqual(first.state.players[1].tokens, initial.players[1].tokens);
        assert.equal(await first.page.locator('.picks .token').count(), 0);
        await disabledTurn(first);
        assert.equal(await double(second, 0).isDisabled(), true, 'bank with fewer than four cannot supply +2');
        assert.equal(await double(second, 1).isEnabled(), true);

        const beforeThree = structuredClone(second.state);
        for (const index of [1, 2, 3]) await activate(single(second, index));
        assert.equal(await second.page.locator('.picks .token').count(), 3);
        assert.equal(await confirm(second).isEnabled(), true);
        await unchanged(second, beforeThree);
        await activate(confirm(second));
        await waitFor(() => second.state.turnCount === beforeThree.turnCount + 1 && first.state.current === 0,
          'Confirming three different energy must advance the turn once');
        assert.deepEqual(second.actions, [{ type: 'TAKE_THREE', gems: ['blue', 'green', 'red'] }]);
        assert.deepEqual(second.state.bank, { ...beforeThree.bank,
          blue: beforeThree.bank.blue - 1, green: beforeThree.bank.green - 1, red: beforeThree.bank.red - 1 });
        assert.deepEqual(second.state.players[1].tokens, { ...beforeThree.players[1].tokens, blue: 1, green: 1, red: 1 });
        assert.deepEqual(second.state.players[0].tokens, beforeThree.players[0].tokens);
        assert.equal(await confirm(first).isDisabled(), true, 'new turn must start with no stale selection');
        assert.equal(await first.page.locator('.bank-col > .token.sel').count(), 0);
        assert.deepEqual(errors, []);
        console.log(`PASS [${engine}, ${mobile ? 'mobile touch' : 'desktop'}]: +2 stays selected until Take energy; cancel/switch, turn/bank guards, and Take 3 verified`);
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
