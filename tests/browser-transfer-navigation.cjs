// Run only against an isolated test server. PLAYWRIGHT_PATH may point to an
// externally installed Playwright package; no browser tooling ships with the app.
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.TEST_ORIGIN;
if (!origin) throw new Error('TEST_ORIGIN must name an isolated test server');
const url = origin + '/splendor/';
const engine = process.env.TEST_BROWSER || 'chromium';

(async () => {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    ...(engine === 'chromium' ? {
      args: ['--no-sandbox'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    } : {}),
  });
  const errors = [];
  async function page() {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 }, locale: 'ko-KR',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK',
      isMobile: true, hasTouch: true,
    });
    await context.addInitScript(() => {
      if (!/^https?:$/.test(location.protocol)) return;
      localStorage.setItem('poke-splendor-lang', 'ko');
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined });
      Object.defineProperty(HTMLElement.prototype, 'webkitRequestFullscreen', { configurable: true, value: undefined });
    });
    const result = await context.newPage();
    result.on('pageerror', (error) => errors.push(error.message));
    result.setDefaultTimeout(10000);
    return result;
  }
  async function makeRoom(source, name) {
    await source.goto(url);
    await source.locator('.conn.on').waitFor();
    await source.getByLabel('트레이너 이름').fill(name);
    await source.getByRole('button', { name: '방 만들기', exact: true }).click();
    await source.locator('.lobby').waitFor();
    return source.url();
  }
  async function moveLink(source) {
    await source.getByRole('button', { name: '전체화면 시작', exact: true }).click();
    await source.getByText('이동 링크가 준비됐어요.', { exact: false }).waitFor();
    const link = await source.getByLabel('현재 게임 링크').inputValue();
    assert.equal(link, source.url());
    assert.equal(new URL(link).searchParams.get('handoff'), '1');
    await source.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(source.url(), link, 'source share-sheet restore must not clear/consume its staged ticket');
    return link;
  }
  // Strip the navigation flag deliberately: old links have only #resume, and
  // Safari can restore an existing document rather than mount React again.
  async function navigateSameDocument(target, link) {
    const destination = new URL(target.url());
    destination.hash = new URL(link).hash;
    await target.evaluate(() => { window.navigationTestMarker = 'old document'; });
    await target.goto(destination.href);
  }
  try {
    const source = await page();
    const target = await page();
    const publicLink = await makeRoom(source, '게임원본');
    await source.getByRole('button', { name: /컴퓨터 추가/ }).click();
    await source.getByRole('button', { name: '게임 시작 (2)', exact: true }).click();
    await source.locator('.game').waitFor();
    const sourceId = await source.evaluate(() => localStorage.getItem('poke-splendor-pid'));
    await target.goto(publicLink);
    await target.locator('.conn.on').waitFor();
    await target.getByLabel('트레이너 이름').fill('다른브라우저');
    await target.getByRole('button', { name: '참가', exact: true }).click();
    await target.getByText('That game has already started.', { exact: true }).waitFor();
    const link = await moveLink(source);
    await source.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await source.getByRole('button', { name: '이동 링크 복사', exact: true }).click();
    await source.getByRole('alert').filter({ hasText: '자동 복사가 차단됐어요' }).waitFor();
    await navigateSameDocument(target, link);
    await target.locator('.game').waitFor();
    assert.equal(await target.evaluate(() => window.navigationTestMarker), undefined, 'incoming hash reloads existing document');
    assert.equal(await target.evaluate(() => localStorage.getItem('poke-splendor-pid')), sourceId);
    assert.equal(new URL(target.url()).hash, '');
    assert.equal(new URL(target.url()).searchParams.has('handoff'), false);
    await source.getByRole('heading', { name: '다른 브라우저로 이동했어요' }).waitFor();
    console.log(`PASS [${engine}]: same-document transfer resumes after an earlier game-join failure`);

    // A user may paste a copied link more than once. The same receiving tab
    // must reuse its private claim, not fail as a replay.
    await target.goto(link);
    await target.locator('.game').waitFor();
    assert.equal(await target.evaluate(() => localStorage.getItem('poke-splendor-pid')), sourceId);
    assert.equal(new URL(target.url()).hash, '');
    console.log(`PASS [${engine}]: pasting the same link again in the receiving tab keeps the seat`);

    const lobbySource = await page();
    const lobbyTarget = await page();
    const lobbyLink = await makeRoom(lobbySource, '로비원본');
    const lobbySourceId = await lobbySource.evaluate(() => localStorage.getItem('poke-splendor-pid'));
    await lobbyTarget.goto(lobbyLink);
    await lobbyTarget.locator('.conn.on').waitFor();
    await lobbyTarget.getByLabel('트레이너 이름').fill('잘못된자리');
    await lobbyTarget.getByRole('button', { name: '참가', exact: true }).click();
    await lobbyTarget.locator('.lobby').waitFor();
    const lobbyMove = await moveLink(lobbySource);
    await navigateSameDocument(lobbyTarget, lobbyMove);
    await lobbySource.getByRole('heading', { name: '다른 브라우저로 이동했어요' }).waitFor();
    await lobbyTarget.locator('.lobby').waitFor();
    assert.equal(await lobbyTarget.evaluate(() => localStorage.getItem('poke-splendor-pid')), lobbySourceId);
    assert.equal(await lobbyTarget.locator('.seat:not(.empty)').count(), 1, 'previous unrelated lobby seat is released before claiming');
    console.log(`PASS [${engine}]: same-document transfer leaves a previously joined unrelated seat`);

    // Simulate a restored BFCache document whose URL contains a new move ticket.
    const restoredTarget = await page();
    await restoredTarget.goto(lobbyLink);
    await restoredTarget.locator('.conn.on').waitFor();
    const secondLink = await moveLink(lobbyTarget);
    await restoredTarget.evaluate((link) => {
      history.replaceState({}, '', link);
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    }, secondLink);
    await restoredTarget.locator('.lobby').waitFor();
    assert.equal(await restoredTarget.evaluate(() => localStorage.getItem('poke-splendor-pid')), lobbySourceId);
    console.log(`PASS [${engine}]: restored document notices a newly received transfer`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
