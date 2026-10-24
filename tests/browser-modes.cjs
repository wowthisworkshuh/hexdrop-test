// Real-input saved-game, merge and hold regressions for all four game modes.
// Uses normal save files and unlock thresholds, never game debug hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const engineName = process.env.BROWSER_ENGINE || 'chromium';
const engine = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[engineName];
const packed = engineName === 'chromium' && process.env.CHROMIUM_MODULE ? require(process.env.CHROMIUM_MODULE) : null;
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(root, 'index.html'), 'utf8');
const build = html.match(/var BUILD\s*=\s*"([^"]+)"/)[1];
const cases = [
  { mode: 'zen', title: 'ZEN', rise: 6 },
  { mode: 'hard', title: 'HARD', rise: 7 },
  { mode: 'time', title: 'TIME ATTACK', rise: 13 },
  { mode: 'power', title: 'POWER ATTACK', rise: 6 }
];

(async () => {
  let browser, server;
  const external = [], writes = [], errors = [], results = [];
  const output = process.env.MODE_OUTPUT_DIR && path.resolve(process.env.MODE_OUTPUT_DIR);
  if (output) fs.mkdirSync(output, { recursive: true });
  try {
    server = http.createServer((req, res) => {
      if (req.method !== 'GET') { writes.push({ method: req.method, path: req.url }); res.writeHead(405); res.end(); return; }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/version.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ build, feedback: false, serviceRevision: 999 })); return;
      }
      if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const launch = { headless: true };
    if (process.env.BROWSER_EXECUTABLE_PATH) launch.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    else if (packed) {
      launch.executablePath = await packed.executablePath();
      launch.args = packed.args.filter(argument => argument !== '--single-process');
    }
    browser = await engine.launch(launch);

    for (const config of cases) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      let page;
      try {
        await context.route('**/*', route => {
          if (route.request().url().startsWith(base)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(({ build, config }) => {
          if (sessionStorage.getItem('hexdrop.mode-test-seeded')) return;
          localStorage.setItem('hexdrop.run.v2', JSON.stringify({ v: 3, mode: config.mode,
            score: 0, drops: 0, chain: 0, combo: 0, nextRiseAt: config.rise, riseLeft: 13000,
            cols: [[0, 0], [], [], [], [], []], bag: [0, 1, 2, 0], held: null, holdUsed: false,
            focus: [-1, -1], mergeAgo: null, playMs: 0, pc: null, pq: [] }));
          localStorage.setItem('hexdrop.seen', '1');
          ['zen', 'hard', 'time', 'power'].forEach(mode => localStorage.setItem('hexdrop.seen.' + mode, '1'));
          // Unlock Power through the ordinary per-mode best-score gates.
          localStorage.setItem('hexdrop.best.zen', '2000000');
          localStorage.setItem('hexdrop.best.hard', '1000000');
          localStorage.setItem('hexdrop.best.time', '2000000');
          localStorage.removeItem('hexdrop.power'); localStorage.removeItem('hexdrop.debug');
          localStorage.setItem('hexdrop.patchNotesSeen', build);
          localStorage.setItem('hexdrop.installSeen', String(Date.now()));
          localStorage.setItem('hexdrop.muted', '1'); localStorage.setItem('hexdrop.count', '0');
          localStorage.setItem('hexdrop.metrics.enabled', '0');
          localStorage.setItem('hexdrop.service', JSON.stringify({ url: '', revision: 999 }));
          sessionStorage.setItem('hexdrop.mode-test-seeded', '1');
        }, { build, config });
        page = await context.newPage(); page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(config.mode + ': ' + error.message));
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('hexdrop.run.v2')));
        const continueRun = async () => {
          await page.locator('[data-act="continue"]').tap();
          await page.locator('#cv').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#modePill').innerText(), config.title);
        };
        const toMenu = async () => { await page.locator('#backBtn').tap(); await page.locator('#modes').waitFor({ state: 'visible' }); };
        const dropAt = async column => {
          const board = await page.locator('#cv').boundingBox(); assert(board);
          await page.touchscreen.tap(board.x + board.width * (1 + 1.5 * column) / 9.5, board.y + board.height / 2);
        };
        await page.goto(base);
        assert.equal(await page.locator('[data-act="play"][data-mode="power"]').count(), 1);
        assert.notEqual(await page.evaluate(() => localStorage.getItem('hexdrop.debug')), '1');
        await continueRun();
        await page.waitForFunction(() => !document.getElementById('holdBtn').disabled);
        await dropAt(0);
        await page.waitForFunction(() => {
          const run = JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null');
          return run && run.drops === 1 && run.cols[0].length === 1 && run.cols[0][0] === 1 &&
            run.cols.slice(1).every(column => column.length === 0) && !document.getElementById('holdBtn').disabled;
        }, {}, { polling: 50, timeout: 10000 });
        const merged = await saved();
        assert.equal(merged.score, 36, 'a first three-tile merge must not receive a recent-merge speed bonus');
        assert.equal(merged.mode, config.mode);

        await page.locator('#holdBtn').tap();
        assert.equal(await page.locator('#holdBtn').isDisabled(), true);
        const beforeRepeat = await page.locator('#chipNow').innerHTML();
        const holdBox = await page.locator('#holdBtn').boundingBox(); assert(holdBox);
        await page.touchscreen.tap(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
        assert.equal(await page.locator('#chipNow').innerHTML(), beforeRepeat, 'a second physical hold tap before a drop must do nothing');
        await toMenu(); const held = await saved();
        assert.equal(held.held, 1); assert.equal(held.bag[0], 2); assert.equal(held.holdUsed, true);
        assert.equal(held.score, merged.score); assert.equal(held.drops, 1); assert.deepEqual(held.cols, merged.cols);

        await page.reload(); await continueRun();
        await page.waitForFunction(previous => {
          const run = JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null');
          return run && run.playMs > previous;
        }, held.playMs, { polling: 50, timeout: 10000 });
        const restored = await saved();
        assert.equal(restored.mode, config.mode); assert.equal(restored.score, held.score); assert.deepEqual(restored.cols, held.cols);
        assert.equal(restored.held, 1); assert.equal(restored.bag[0], 2); assert.equal(restored.holdUsed, true);
        assert.equal(await page.locator('#holdBtn').isDisabled(), true, 'Continue must not reset the once-per-drop hold lock');
        assert.equal((await page.locator('#score').innerText()).replace(/\D/g, ''), '36');

        await dropAt(5);
        await page.waitForFunction(() => {
          const run = JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null');
          return run && run.drops === 2 && !run.holdUsed && !document.getElementById('holdBtn').disabled;
        }, {}, { polling: 50, timeout: 10000 });
        const afterDrop = await saved();
        assert.deepEqual(afterDrop.cols, [[1], [], [], [], [], [2]]); assert.equal(afterDrop.score, 36);
        await page.locator('#holdBtn').tap(); await toMenu();
        const final = await saved();
        assert.equal(final.holdUsed, true); assert.equal(final.held, 0); assert.equal(final.bag[0], 1);
        assert.equal(final.drops, 2); assert.equal(final.score, 36); assert.deepEqual(final.cols, afterDrop.cols);
        results.push({ mode: config.mode, score: merged.score, drops: final.drops, board: final.cols,
          restoredMode: restored.mode, holdLockRestored: restored.holdUsed, holdReenabledAfterDrop: true });
      } catch (error) {
        if (output && page) {
          try { await page.screenshot({ path: path.join(output, config.mode + '-failure.png') }); } catch (screenshotError) {}
          try { fs.writeFileSync(path.join(output, config.mode + '-failure.json'), JSON.stringify(await page.evaluate(() => ({
            saved: JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null'), mode: document.getElementById('modePill')?.textContent,
            score: document.getElementById('score')?.textContent, holdDisabled: document.getElementById('holdBtn')?.disabled
          })), null, 2)); } catch (snapshotError) {}
        }
        throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(external, [], 'no external service request should be attempted');
    assert.deepEqual(writes, [], 'all local requests must be read-only'); assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, engineName + '-modes.json'), JSON.stringify({ build, engine: engineName, results }, null, 2));
    console.log(`PASS ${engineName} ${build}: all four modes merge first three tier-0 tiles for 36; preserve exact mode/board/score/hold lock across reload and Continue; hold works once per drop`);
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
