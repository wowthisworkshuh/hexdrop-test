// Full-page online leaderboard smoke test. Every service request is mocked.
// Install Playwright/Chromium separately; environment overrides match browser-smoke.cjs.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const engine = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[process.env.BROWSER_ENGINE || 'chromium'];
const packed = process.env.CHROMIUM_MODULE ? require(process.env.CHROMIUM_MODULE) : null;
const root = path.resolve(__dirname, '..');
const target = process.env.HEXDROP_HTML || path.join(root, 'index.html');
const build = fs.readFileSync(target, 'utf8').match(/var BUILD\s*=\s*"([^"]+)"/)[1];
const service = 'https://hexdrop-service.test/exec';

(async () => {
  let browser, server;
  const requests = [], unexpected = [], errors = [];
  let failBoardReads = false;
  const players = new Map(), best = new Map();
  try {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/version.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ build, feedback: service, serviceRevision: 999 }));
        return;
      }
      const file = path.resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (!file.startsWith(root + path.sep) || file.includes(path.sep + '.git' + path.sep)) {
        res.writeHead(403); res.end(); return;
      }
      fs.readFile(url.pathname === '/' || url.pathname === '/index.html' ? target : file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
        res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    browser = await engine.launch(packed ? {
      executablePath: await packed.executablePath(), args: packed.args, headless: true
    } : { headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      serviceWorkers: 'block'
    });
    await context.addInitScript(({ service, build }) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date()).map(x => [x.type, x.value]));
      const day = p.year + '-' + p.month + '-' + p.day;
      localStorage.setItem('hexdrop.seen', '1');
      localStorage.setItem('hexdrop.patchNotesSeen', build);
      localStorage.setItem('hexdrop.installSeen', String(Date.now()));
      localStorage.setItem('hexdrop.count', '0');
      localStorage.setItem('hexdrop.service', JSON.stringify({ url: service, revision: 999 }));
      // No capability seed: opening the sheet must itself discover the service.
      localStorage.setItem('hexdrop.lb.local', JSON.stringify({
        zen: { d: { k: day, s: 300, at: Date.now() }, m: { k: day.slice(0, 7), s: 300, at: Date.now() }, all: { s: 300, at: Date.now() } }
      }));
    }, { service, build });
    await context.route('**/*', async route => {
      const request = route.request(), url = request.url();
      if (url.startsWith(base)) { await route.continue(); return; }
      if (!url.startsWith(service)) { unexpected.push(url); await route.abort(); return; }
      const body = request.method() === 'POST' ? JSON.parse(request.postData()) : {};
      requests.push(body);
      let result;
      if (body.action === 'join') {
        assert(body.id && body.name);
        players.set(body.id, { name: body.name, color: body.color });
        result = { ok: true, name: body.name, color: body.color, shifted: false };
      } else if (body.action === 'scores') {
        assert(players.has(body.id), 'score upload requires a joined identity');
        assert(body.entries.length > 0, 'join must upload the saved local results');
        for (const entry of body.entries) best.set(body.id + '|' + entry.mode,
          Math.max(best.get(body.id + '|' + entry.mode) || 0, entry.score));
        result = { ok: true, saved: body.entries.length };
      } else if (body.action === 'leave') {
        assert(players.has(body.id), 'deletion must use the joined identity');
        players.delete(body.id);
        result = { ok: true, removed: true };
      } else if (body.action === 'board') {
        if (failBoardReads) {
          await new Promise(resolve => setTimeout(resolve, 180));
          await route.abort('failed'); return;
        }
        const score = { day: 900, month: 1800, all: 2700 }[body.period];
        const top = [{ r: 1, n: body.mode + '-' + body.period + '-leader', c: '#FD9CBA', s: score, d: 0, me: false }];
        const player = players.get(body.id), mine = player && best.get(body.id + '|' + body.mode);
        let me = null;
        if (mine) {
          me = { rank: 2, score: mine, name: player.name, color: player.color, dup: 0 };
          top.push({ r: 2, n: player.name, c: player.color, s: mine, d: 0, me: true });
        }
        result = { ok: true, mode: body.mode, period: body.period, top, total: top.length, me };
        if (body.probe) result.probe = { rank: 2, score: body.probe };
      } else {
        assert.equal(request.method(), 'GET', 'unexpected mutation action');
        await new Promise(resolve => setTimeout(resolve, 150));
        result = { ok: true, features: ['feedback', 'boards'], protocol: 2, countEventIds: true };
      }
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        assert(Date.now() < deadline, 'Timed out waiting for ' + label);
        await page.waitForTimeout(30);
      }
    };
    await page.goto(base);
    await page.locator('#mBoard').tap();
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('Checking the online leaderboards'));
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('zen-day-leader'));
    assert.equal(requests.filter(x => !x.action).length, 1, 'cold open shares capability discovery');
    assert.equal(requests.filter(x => x.action === 'board').length, 1, 'cold open loads its board without another tap');
    await page.locator('[data-per="day"]').tap();
    await page.locator('[data-lbmode="zen"]').tap();
    await page.locator('#sheet .close').tap();
    await page.locator('#mBoard').tap();
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('zen-day-leader'));
    assert.equal(requests.filter(x => x.action === 'board').length, 1, 'selected tabs and fresh reopen reuse the saved board');
    // Age the persisted record, reload to discard memory, then simulate one failed refresh.
    await page.locator('#sheet .close').tap();
    await page.evaluate(() => {
      const key = 'hexdrop.lb.cache.zen|day', cached = JSON.parse(localStorage.getItem(key));
      cached.at = Date.now() - 121000; localStorage.setItem(key, JSON.stringify(cached));
    });
    failBoardReads = true;
    await page.reload(); await page.locator('#mBoard').tap();
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('Saved 2 minutes ago. Updating'));
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('Couldn’t update'));
    assert.equal(await page.locator('#lbRetry').isEnabled(), true);
    failBoardReads = false;
    const healthBeforeRefresh = requests.filter(x => !x.action).length;
    await page.locator('#lbRetry').tap();
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('Saved just now'));
    assert.equal(requests.filter(x => !x.action).length, healthBeforeRefresh, 'Refresh reuses healthy capability data');
    for (const period of ['month', 'all', 'day']) {
      await page.locator('[data-per="' + period + '"]').tap();
      await page.waitForFunction(p => document.querySelector('#lbPane')?.textContent.includes('zen-' + p + '-leader'), period);
    }
    for (const mode of ['hard', 'time', 'zen']) {
      await page.locator('[data-lbmode="' + mode + '"]').tap();
      await page.waitForFunction(m => document.querySelector('#lbPane')?.textContent.includes(m + '-day-leader'), mode);
    }
    await page.locator('#lbJoin').tap();
    await page.locator('#lbName').fill('SmokePlayer');
    await page.locator('#sheetGo').tap();
    await waitFor(() => requests.some(x => x.action === 'scores'), 'saved score upload');
    await page.waitForFunction(() => {
      const me = JSON.parse(localStorage.getItem('hexdrop.lb.me') || 'null');
      return me && !me.pending && JSON.parse(localStorage.getItem('hexdrop.lb.q') || '[]').length === 0;
    });
    const join = requests.find(x => x.action === 'join');
    const scoreRequest = requests.find(x => x.action === 'scores');
    assert.equal(join.name, 'SmokePlayer');
    assert.equal(scoreRequest.id, join.id);
    assert(scoreRequest.entries.some(x => x.mode === 'zen' && x.score === 300));
    await page.waitForFunction(() => document.querySelector('#sheet')?.getAttribute('data-kind') === 'board');
    await page.locator('#sheet .close').tap();
    await page.locator('#mBoard').tap();
    await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('SmokePlayer'));
    assert.equal(await page.locator('#lbMine .lbtag').innerText(), 'YOU');
    const personalRead = requests.filter(x => x.action === 'board' && x.id).at(-1);
    assert.equal(personalRead.id, join.id);
    await page.locator('#sheet .close').tap();
    await page.locator('#mSet').tap();
    await page.locator('[data-stab="options"]').tap();
    await page.locator('#optLbLeave').tap();
    await page.locator('#optLbLeave').tap();
    await waitFor(() => requests.some(x => x.action === 'leave'), 'membership deletion');
    await page.waitForFunction(() => localStorage.getItem('hexdrop.lb.me') === null);
    assert.equal(requests.find(x => x.action === 'leave').id, join.id);
    assert.equal(players.size, 0);
    assert.deepEqual(unexpected, [], 'all service calls must use the mocked endpoint');
    assert.deepEqual(errors, [], 'online leaderboard UI must not throw JavaScript errors');
    console.log('PASS: cold capability discovery, shared/fresh reads, stale saved age and failed-refresh retry, period/mode reads, opt-in join, score upload, personal rank, deletion');
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
