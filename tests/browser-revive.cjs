// Actual game-over/Continue UI and persisted lifetime-credit regression.
// All four modes use ordinary saved-game fixtures; no private game hooks.
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
const modes = ['zen', 'hard', 'time', 'power'];

(async () => {
  let browser, server;
  const external = [], writes = [], errors = [], results = [];
  const output = process.env.REVIVE_OUTPUT_DIR && path.resolve(process.env.REVIVE_OUTPUT_DIR);
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

    for (const mode of modes) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      let page;
      try {
        await context.route('**/*', route => {
          if (route.request().url().startsWith(base)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(({ build, mode }) => {
          if (sessionStorage.getItem('hexdrop.revive-test-seeded')) return;
          localStorage.setItem('hexdrop.run.v2', JSON.stringify({ v: 3, mode, score: 100, drops: 3,
            chain: 0, combo: 0, nextRiseAt: 10, riseLeft: 13000,
            cols: [[0, 1, 2, 0, 1, 2, 0], [], [], [], [], []], bag: [0, 1, 2, 0], held: null,
            revived: false, runRecorded: false, runCredited: 0,
            focus: [-1, -1], mergeAgo: null, playMs: 1000, pc: null, pq: [] }));
          localStorage.setItem('hexdrop.seen', '1');
          ['zen', 'hard', 'time', 'power'].forEach(value => localStorage.setItem('hexdrop.seen.' + value, '1'));
          localStorage.setItem('hexdrop.best.zen', '2000000');
          localStorage.setItem('hexdrop.best.hard', '1000000');
          localStorage.setItem('hexdrop.best.time', '2000000');
          localStorage.removeItem('hexdrop.power'); localStorage.removeItem('hexdrop.debug');
          localStorage.setItem('hexdrop.patchNotesSeen', build);
          localStorage.setItem('hexdrop.installSeen', String(Date.now()));
          localStorage.setItem('hexdrop.noads', '1'); // free test entitlement: Continue requires no ad traffic
          localStorage.setItem('hexdrop.muted', '1'); localStorage.setItem('hexdrop.count', '0');
          localStorage.setItem('hexdrop.metrics.enabled', '0');
          localStorage.setItem('hexdrop.service', JSON.stringify({ url: '', revision: 999 }));
          sessionStorage.setItem('hexdrop.revive-test-seeded', '1');
        }, { build, mode });
        page = await context.newPage(); page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(mode + ': ' + error.message));
        const stats = () => page.evaluate(() => JSON.parse(localStorage.getItem('hexdrop.stats') || 'null'));
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null'));
        await page.goto(base); await page.locator('[data-act="continue"]').tap();
        await page.locator('#btnRevive').waitFor({ state: 'visible' });
        const first = await stats(); assert.equal(first.runs, 1); assert.equal(first.lifetime, 100);
        assert.match(await page.locator('#btnRevive').innerText(), /^Continue/);
        await page.locator('#btnRevive').tap();
        await page.waitForFunction(() => {
          const run = JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null');
          return run && run.revived && run.cols[0].length === 5 && !document.getElementById('holdBtn').disabled;
        }, {}, { polling: 50, timeout: 10000 });
        const revived = await saved();
        assert.equal(revived.mode, mode); assert.equal(revived.score, 100);
        assert.equal(revived.runRecorded, true); assert.equal(revived.runCredited, 100);
        assert.equal((await stats()).lifetime, 100, 'reviving must not immediately credit the same score again');
        await page.locator('#backBtn').tap(); await page.locator('#modes').waitFor({ state: 'visible' });
        const ledger = await saved();
        assert.equal(ledger.runRecorded, true); assert.equal(ledger.runCredited, 100);
        // Model earning 50 more points then topping out. This edits only the
        // normal save fixture while on the menu, so pagehide cannot overwrite
        // it with the previous in-memory run. No application function is called.
        await page.evaluate(() => {
          const run = JSON.parse(localStorage.getItem('hexdrop.run.v2'));
          run.score = 150; run.cols = [[0, 1, 2, 0, 1, 2, 0], [], [], [], [], []];
          run.focus = [-1, -1]; run.pendingRise = false; run.moveOpen = false;
          run.clearArmed = false; run.merged = false; run.riseLeft = 13000;
          localStorage.setItem('hexdrop.run.v2', JSON.stringify(run));
        });
        await page.reload(); await page.locator('[data-act="continue"]').tap();
        await page.locator('#veil').waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const stats = JSON.parse(localStorage.getItem('hexdrop.stats') || 'null');
          return stats && stats.lifetime === 150;
        });
        const final = await stats();
        assert.equal(final.runs, 1, 'both top-outs belong to one logical run');
        assert.equal(final.lifetime, 150, 'second top-out must credit only the additional 50 points');
        assert.equal(final.bestRun, 150); assert.equal(await page.locator('#btnRevive').count(), 0, 'one run cannot revive twice');
        assert.equal(await saved(), null, 'completed run should no longer be offered as Continue');
        await page.waitForTimeout(150);
        assert.equal((await stats()).runs, 1); assert.equal((await stats()).lifetime, 150, 'later frames must not repeat game-over accounting');
        results.push({ mode, firstTopOut: { runs: first.runs, lifetime: first.lifetime },
          revivedLedger: { runRecorded: revived.runRecorded, runCredited: revived.runCredited },
          finalTopOut: { runs: final.runs, lifetime: final.lifetime, bestRun: final.bestRun } });
      } catch (error) {
        if (output && page) {
          try { await page.screenshot({ path: path.join(output, mode + '-failure.png') }); } catch (screenshotError) {}
          try { fs.writeFileSync(path.join(output, mode + '-failure.json'), JSON.stringify(await page.evaluate(() => ({
            saved: JSON.parse(localStorage.getItem('hexdrop.run.v2') || 'null'), stats: JSON.parse(localStorage.getItem('hexdrop.stats') || 'null'),
            mode: document.getElementById('modePill')?.textContent, veil: document.getElementById('veil')?.innerText
          })), null, 2)); } catch (snapshotError) {}
        }
        throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(external, [], 'no external service request should be attempted');
    assert.deepEqual(writes, [], 'all local requests must be read-only'); assert.deepEqual(errors, []);
    if (output) fs.writeFileSync(path.join(output, engineName + '-revive.json'), JSON.stringify({ build, engine: engineName, results }, null, 2));
    console.log(`PASS ${engineName} ${build}: all four modes record top-out 100 once, persist the Continue ledger, then credit only 50 more after restored top-out 150; runs remain one`);
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
