// Optional full-page patch-notes regression. All network writes are blocked.
// Supports HEXDROP_HTML for the Android asset and the usual browser overrides.
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
const webBuild = /window\.HEXDROP_WEB\s*=/.test(html);
const futureMarker = 'FUTURE-NOTES-MUST-NOT-REPLACE-BUNDLED-NOTES';
const title = new RegExp("what['’]s new in " + build, 'i');

(async () => {
  let server, browser;
  const writes = [], external = [], errors = [], passed = [];
  try {
    server = http.createServer((req, res) => {
      if (req.method !== 'GET') { writes.push({ method: req.method, url: req.url }); res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/version.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ build: 'b999', notes: futureMarker, feedback: false, serviceRevision: 999 }));
        return;
      }
      if (url.pathname !== '/' && url.pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const launch = { headless: true };
    if (process.env.BROWSER_EXECUTABLE_PATH) launch.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    else if (packed) {
      launch.executablePath = await packed.executablePath();
      // Multiple isolated contexts are required for fresh/returning-player cases.
      launch.args = packed.args.filter(arg => arg !== '--single-process');
    }
    browser = await engine.launch(launch);

    async function scenario(options, run) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => {
          if (route.request().url().startsWith(base)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(({ returning, previous, quickContinue }) => {
          if (sessionStorage.getItem('hexdrop.patch-notes-test-seeded')) return;
          if (returning) localStorage.setItem('hexdrop.seen', '1');
          else localStorage.removeItem('hexdrop.seen');
          localStorage.setItem('hexdrop.installSeen', String(Date.now()));
          localStorage.setItem('hexdrop.muted', '1');
          localStorage.setItem('hexdrop.count', '0');
          localStorage.setItem('hexdrop.service', JSON.stringify({ url: '', revision: 999 }));
          if (previous) localStorage.setItem('hexdrop.patchNotesSeen', previous);
          else localStorage.removeItem('hexdrop.patchNotesSeen');
          if (quickContinue) {
            localStorage.setItem('hexdrop.seen.zen', '1');
            localStorage.setItem('hexdrop.run.v2', JSON.stringify({ v: 3, mode: 'zen', score: 36, drops: 1,
              chain: 0, combo: 0, nextRiseAt: 10, cols: [[1], [], [], [], [], []], bag: [0, 1, 2, 0], held: null,
              focus: [-1, -1], mergeAgo: 10000, pc: null, pq: [] }));
            // Activate the normal Continue button immediately after boot. This
            // avoids browser-action latency turning a <250ms race into a flaky test.
            document.addEventListener('DOMContentLoaded', () => {
              const button = document.querySelector('[data-act="continue"]');
              if (button) button.click();
            }, { once: true });
          }
          sessionStorage.setItem('hexdrop.patch-notes-test-seeded', '1');
        }, { returning: true, previous: null, quickContinue: false, ...options });
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await run(page);
      } finally { await context.close(); }
    }

    async function notes(page) {
      const sheet = page.locator('[data-kind="patchnotes"]');
      await sheet.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await sheet.locator('h2').innerText(), title);
      return sheet;
    }
    async function acknowledge(page, how) {
      const sheet = await notes(page);
      if (how === 'footer') {
        assert.equal((await sheet.locator('#sheetGo').innerText()).trim(), 'Got it');
        await sheet.locator('#sheetGo').tap();
      } else await sheet.locator('.close').tap();
      await page.waitForFunction(() => !document.querySelector('[data-kind="patchnotes"]'));
      assert.equal(await page.evaluate(() => localStorage.getItem('hexdrop.patchNotesSeen')), build);
    }

    await scenario({}, async page => {
      await page.goto(base); await notes(page);
      assert.equal(await page.evaluate(() => localStorage.getItem('hexdrop.patchNotesSeen')), null,
        'opening notes must not count as acknowledgement');
      await acknowledge(page, 'footer');
      await page.reload(); await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 0, 'acknowledged notes must stay closed after reload');
      await page.locator('#mSet').tap(); await page.locator('[data-stab="options"]').tap();
      await page.locator('#optPatchNotes').tap();
      const sheet = await notes(page);
      assert.match((await sheet.locator('#sheetGo').innerText()).trim(), /^(?:‹\s*)?Back to Settings$/);
      await sheet.locator('#sheetGo').tap();
      await page.locator('[data-kind="settings"] #optPatchNotes').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => localStorage.getItem('hexdrop.patchNotesSeen')), build);
      passed.push('returning player: automatic notes, Got it, reload suppression, Settings reopen/back');
    });

    await scenario({ previous: 'b33' }, async page => {
      await page.goto(base); await notes(page); await acknowledge(page, 'close');
      await page.reload(); await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 0);
      passed.push('older acknowledgement: current notes appear once and Close acknowledges');
    });

    await scenario({ returning: false }, async page => {
      await page.goto(base);
      await page.locator('[data-kind="help"]').waitFor({ state: 'visible' });
      await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 0, 'a fresh player must keep the introduction');
      await page.locator('[data-kind="help"] .close').tap(); await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 0, 'finishing the introduction must not create an update popup');
      assert.equal(await page.evaluate(() => localStorage.getItem('hexdrop.patchNotesSeen')), build, 'fresh installs establish the current baseline');
      passed.push('fresh player: introduction preserved and current notes baselined');
    });

    await scenario({ previous: 'b33', quickContinue: true }, async page => {
      await page.goto(base); await page.locator('#cv').waitFor({ state: 'visible' });
      await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 0, 'notes must never interrupt a resumed run');
      assert.equal(await page.evaluate(() => localStorage.getItem('hexdrop.patchNotesSeen')), 'b33');
      assert.equal((await page.locator('#score').innerText()).replace(/\D/g, ''), '36');
      await page.locator('#backBtn').tap(); await notes(page); await acknowledge(page, 'footer');
      passed.push('quick Continue: popup deferred during gameplay, then offered on menu return');
    });

    if (webBuild) {
      await scenario({ previous: 'b33' }, async page => {
        const update = page.waitForResponse(response => new URL(response.url()).pathname === '/version.json', { timeout: 10000 });
        await page.goto(base); const sheet = await notes(page), before = await sheet.innerText();
        const response = await update; assert.equal((await response.json()).build, 'b999');
        await page.waitForTimeout(150);
        assert.equal(await page.locator('[data-kind="patchnotes"]').count(), 1);
        assert.equal(await page.locator('[data-kind="update"]').count(), 0, 'a future-build prompt must not replace the current notes');
        assert.equal(await sheet.innerText(), before, 'current notes must come from the bundle, not downloaded metadata');
        assert.doesNotMatch(await sheet.innerText(), /b999|FUTURE-NOTES-MUST-NOT-REPLACE-BUNDLED-NOTES/);
        passed.push('future version.json: b999 metadata cannot replace or rewrite current-build notes');
      });
    }
    assert.deepEqual(writes, [], 'no local mutation requests are allowed');
    assert.deepEqual(external, [], 'no external requests should be attempted');
    assert.deepEqual(errors, [], 'all scenarios must complete without JavaScript errors');
    console.log(`PASS ${engineName} ${build}: ${passed.join('; ')}`);
    if (!webBuild) console.log('Native asset: version.json response case is inapplicable because no web update polling is configured.');
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
