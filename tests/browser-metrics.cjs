// Optional full-page local-diagnostics regression. No live service requests.
// Supports HEXDROP_HTML, Chromium/WebKit and the usual browser overrides.
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
const privateMarkers = ['PRIVATE-LOCAL-STORAGE-MARKER', 'private-metrics-player-id', 'NeverShareMe', 'PRIVATE-FEEDBACK-DRAFT'];

(async () => {
  let browser, server;
  const writes = [], external = [], errors = [], passed = [];
  try {
    server = http.createServer((req, res) => {
      if (req.method !== 'GET') { writes.push({ method: req.method, url: req.url }); res.writeHead(405); res.end(); return; }
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

    async function scenario(options, run) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => {
          if (route.request().url().startsWith(base)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(({ build, gpc }) => {
          // Force copy's documented manual-selection fallback, independent of
          // browser clipboard permissions and test-host desktop availability.
          try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('test clipboard unavailable')) } }); } catch (error) {}
          const original = document.execCommand;
          document.execCommand = function (command, ...args) {
            return command === 'copy' ? false : original ? original.call(this, command, ...args) : false;
          };
          if (gpc) Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
          if (sessionStorage.getItem('hexdrop.metrics-test-seeded')) return;
          localStorage.setItem('hexdrop.seen', '1');
          ['zen', 'hard', 'time', 'power'].forEach(mode => localStorage.setItem('hexdrop.seen.' + mode, '1'));
          localStorage.setItem('hexdrop.patchNotesSeen', build);
          localStorage.setItem('hexdrop.installSeen', String(Date.now()));
          localStorage.setItem('hexdrop.muted', '1');
          localStorage.setItem('hexdrop.count', '0');
          localStorage.setItem('hexdrop.metrics.enabled', '1');
          localStorage.setItem('hexdrop.service', JSON.stringify({ url: '', revision: 999 }));
          localStorage.setItem('private-test-storage', 'PRIVATE-LOCAL-STORAGE-MARKER');
          localStorage.setItem('hexdrop.lb.me', JSON.stringify({ id: 'private-metrics-player-id', name: 'NeverShareMe', color: '#FD9CBA' }));
          localStorage.setItem('hexdrop.fbDraft', 'PRIVATE-FEEDBACK-DRAFT');
          sessionStorage.setItem('hexdrop.metrics-test-seeded', '1');
        }, { build, gpc: false, ...options });
        const page = await context.newPage(); page.setDefaultTimeout(8000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.waitForFunction(() => window.HexDropMetrics && typeof window.HexDropMetrics.snapshot === 'function');
        await run(page);
      } finally { await context.close(); }
    }

    async function snapshot(page) { return page.evaluate(() => window.HexDropMetrics.snapshot()); }
    function totals(state) {
      const total = { starts: 0, restores: 0, ends: 0 };
      Object.values(state.days).forEach(day => { total.starts += day.runStarts; total.restores += day.runRestores; total.ends += day.runEnds; });
      return total;
    }
    async function menu(page) {
      await page.locator('#backBtn').tap();
      await page.locator('#modes').waitFor({ state: 'visible' });
    }
    async function play(page, mode = 'zen', resume = false) {
      await page.locator(resume ? '[data-act="continue"]' : `[data-act="play"][data-mode="${mode}"]`).tap();
      await page.locator('#cv').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.getElementById('holdBtn').disabled, {}, { timeout: 10000 });
    }
    async function diagnostics(page) {
      await page.locator('#mSet').tap();
      await page.locator('[data-stab="options"]').tap();
      await page.locator('#optDiagnostics').tap();
      const sheet = page.locator('[data-kind="diagnostics"]');
      await sheet.waitFor({ state: 'visible' });
      return sheet;
    }
    async function closeDiagnostics(page) {
      const sheet = page.locator('[data-kind="diagnostics"]');
      assert.match((await sheet.locator('#sheetGo').innerText()).trim(), /^(?:‹\s*)?Back to Settings$/);
      await sheet.locator('#sheetGo').tap();
      await page.locator('[data-kind="settings"] #optDiagnostics').waitFor({ state: 'visible' });
      await page.locator('[data-kind="settings"] .close').tap();
      await page.locator('#modes').waitFor({ state: 'visible' });
    }

    await scenario({}, async page => {
      assert.deepEqual(totals(await snapshot(page)), { starts: 0, restores: 0, ends: 0 });
      await play(page); assert.deepEqual(totals(await snapshot(page)), { starts: 1, restores: 0, ends: 0 });
      await menu(page); await play(page, 'zen', true);
      assert.deepEqual(totals(await snapshot(page)), { starts: 1, restores: 1, ends: 0 }, 'same-page Continue must count one resume and no additional start');
      await menu(page); await page.reload(); await play(page, 'zen', true);
      assert.deepEqual(totals(await snapshot(page)), { starts: 1, restores: 2, ends: 0 }, 'restoring a saved run after reload counts one more resume, not a new run');
      await menu(page); await play(page, 'zen', true); await menu(page);
      assert.deepEqual(totals(await snapshot(page)), { starts: 1, restores: 3, ends: 0 }, 'each Continue action must count exactly one resume');
      passed.push('real new run and Continue: starts and each resume counted once');

      let sheet = await diagnostics(page);
      const report = sheet.locator('#diagnosticsText');
      assert.notEqual(await report.getAttribute('readonly'), null);
      const text = await report.inputValue(); assert.match(text, /local diagnostics/i); assert.match(text, new RegExp(build));
      const localState = await snapshot(page);
      assert.equal(localState.transportAllowed, false, 'diagnostics must not authorize automatic transport');
      const serialized = JSON.stringify(localState);
      privateMarkers.forEach(marker => {
        assert.equal(text.includes(marker), false, 'report must not expose private local fields');
        assert.equal(serialized.includes(marker), false, 'snapshot must not expose private local fields');
      });
      assert.equal(text.includes('hexdrop.run.v2'), false, 'report must not dump saved-game storage');
      await sheet.locator('#copyMetrics').tap();
      await page.waitForFunction(() => {
        const report = document.getElementById('diagnosticsText');
        return report && report.selectionStart === 0 && report.selectionEnd === report.value.length;
      });
      passed.push('readonly local report omits identity/draft/storage and copy falls back to selection');

      await sheet.locator('#optMetrics').uncheck();
      let off = await snapshot(page); assert.equal(off.collectionEnabled, false);
      const retained = off.days;
      await closeDiagnostics(page);
      await play(page, 'hard'); await menu(page); await play(page, 'hard', true); await menu(page);
      await page.reload(); await play(page, 'hard', true); await menu(page);
      off = await snapshot(page);
      assert.equal(off.collectionEnabled, false); assert.deepEqual(off.days, retained, 'disabled collection must retain old data without adding sessions, runs, frames or time');
      sheet = await diagnostics(page); assert.equal(await sheet.locator('#optMetrics').isChecked(), false, 'opt-out survives reload');
      await sheet.locator('#optMetrics').check(); assert.equal((await snapshot(page)).collectionEnabled, true);
      const beforeClear = totals(await snapshot(page)); assert.equal(beforeClear.starts, 1);
      await sheet.locator('#clearMetrics').tap();
      assert.match(await sheet.locator('#clearMetrics').innerText(), /tap again/i);
      assert.deepEqual(totals(await snapshot(page)), beforeClear, 'first Clear click must only arm confirmation');
      await sheet.locator('#clearMetrics').tap();
      assert.deepEqual(totals(await snapshot(page)), { starts: 0, restores: 0, ends: 0 });
      assert.equal(await sheet.locator('#optMetrics').isChecked(), true, 'clearing stored summaries must preserve collection preference');
      await closeDiagnostics(page); await play(page); await menu(page);
      assert.deepEqual(totals(await snapshot(page)), { starts: 1, restores: 0, ends: 0 }, 'collection can record a fresh run after clear');
      passed.push('opt-out persists without discarding data; two-step Clear resets summaries and collection resumes');
    });

    await scenario({ gpc: true }, async page => {
      const sheet = await diagnostics(page);
      assert.equal(await sheet.locator('#optMetrics').isDisabled(), true);
      assert.equal(await sheet.locator('#optMetrics').isChecked(), false);
      assert.match(await sheet.innerText(), /Global Privacy Control/i);
      const before = await snapshot(page); assert.equal(before.collectionEnabled, false);
      await closeDiagnostics(page); await play(page); await menu(page);
      assert.deepEqual((await snapshot(page)).days, before.days, 'GPC must prevent local metrics collection even when saved preference is on');
      passed.push('Global Privacy Control keeps diagnostics collection off and checkbox unavailable');
    });

    assert.deepEqual(writes, [], 'no local mutation requests are allowed');
    assert.deepEqual(external, [], 'local diagnostics must not attempt external requests');
    assert.deepEqual(errors, [], 'all diagnostics scenarios must run without JavaScript errors');
    console.log(`PASS ${engineName} ${build}: ${passed.join('; ')}`);
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
