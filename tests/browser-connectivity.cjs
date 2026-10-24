// Full-browser regression for slow Apps Script-style health redirects.
// All requests stay on local HTTP fixtures. Public board reads must use GET.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const engineName = process.env.BROWSER_ENGINE || 'chromium';
const engine = require(process.env.PLAYWRIGHT_MODULE || 'playwright')[engineName];
const packed = engineName === 'chromium' && process.env.CHROMIUM_MODULE ? require(process.env.CHROMIUM_MODULE) : null;
const root = path.resolve(__dirname, '..');
const original = fs.readFileSync(process.env.HEXDROP_HTML || path.join(root, 'index.html'), 'utf8');
const build = original.match(/var BUILD\s*=\s*"([^"]+)"/)[1];
const webBuild = /window\.HEXDROP_WEB\s*=/.test(original);
const HEALTH_DELAY_MS = 7000;

(async () => {
  let browser, site, relay, content, current;
  const external = [], forbidden = [], errors = [], passed = [], timers = new Set();
  const responses = new Map();
  let siteOrigin, relayOrigin, contentOrigin, service, served;
  function cors(res) { res.setHeader('access-control-allow-origin', '*'); }
  function redirect(res, target) { cors(res); res.writeHead(302, { location: target }); res.end(); }
  function json(res, value) { cors(res); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
  function reject(req, res) { forbidden.push({ method: req.method, path: req.url }); cors(res); res.writeHead(405); res.end(); }
  async function start(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  }
  function origin(server) { return `http://127.0.0.1:${server.address().port}`; }
  try {
    content = await start((req, res) => {
      if (req.method !== 'GET') { reject(req, res); return; }
      const url = new URL(req.url, contentOrigin);
      const entry = responses.get(url.searchParams.get('request'));
      if (!entry) { res.writeHead(404); res.end(); return; }
      if (url.pathname === '/health') {
        entry.state.redirects.push('content-health');
        const timer = setTimeout(() => {
          timers.delete(timer); entry.state.healthCompletedAt = Date.now();
          json(res, { ok: true, features: ['feedback', 'boards'], protocol: 2, countEventIds: true });
        }, HEALTH_DELAY_MS);
        timers.add(timer); res.on('close', () => { clearTimeout(timer); timers.delete(timer); });
      } else if (url.pathname === '/board') {
        entry.state.redirects.push('content-board'); json(res, entry.value);
      } else { res.writeHead(404); res.end(); }
    });
    contentOrigin = origin(content);
    relay = await start((req, res) => {
      const url = new URL(req.url, relayOrigin);
      if (req.method === 'GET' && url.pathname === '/relay/exec' && url.searchParams.get('action') === 'board') {
        if (url.searchParams.has('id') || [...url.searchParams.keys()].some(key => !['action', 'mode', 'period', 'probe'].includes(key))) {
          reject(req, res); return;
        }
        const body = Object.fromEntries(url.searchParams), state = current;
        const key = `${state.name}-board-${state.boardRequests.length}`;
        state.boardRequests.push({ at: Date.now(), body });
        responses.set(key, { state, value: { ok: true, mode: body.mode, period: body.period,
          top: [{ r: 1, n: 'local-delayed-health-leader', c: '#FD9CBA', s: 480, d: 0, me: false }], total: 1, me: null } });
        redirect(res, `${contentOrigin}/board?request=${encodeURIComponent(key)}`); return;
      }
      if (req.method === 'GET' && url.pathname === '/relay/exec') {
        if (url.searchParams.has('action')) { reject(req, res); return; }
        const state = current, key = `${state.name}-health-${state.healthRequests.length}`;
        state.healthRequests.push({ at: Date.now(), query: url.search });
        state.redirects.push('relay-exec'); responses.set(key, { state });
        redirect(res, `${relayOrigin}/relay/redirect-health?request=${encodeURIComponent(key)}`); return;
      }
      if (req.method === 'GET' && url.pathname === '/relay/redirect-health') {
        const key = url.searchParams.get('request'), entry = responses.get(key);
        assert(entry); entry.state.redirects.push('relay-redirect');
        redirect(res, `${contentOrigin}/health?request=${encodeURIComponent(key)}`); return;
      }
      reject(req, res);
    });
    relayOrigin = origin(relay); service = `${relayOrigin}/relay/exec`;
    // Change only the bundled service address, never the application functions.
    served = original.replace(/window\.HEXDROP_WEB\s*=\s*(\{[^\n]*\});/, (match, raw) => {
      const config = JSON.parse(raw); config.feedback = service;
      return 'window.HEXDROP_WEB=' + JSON.stringify(config) + ';';
    }).replace(/window\.HEXDROP_SERVICE\s*=\s*"[^"]*"/, 'window.HEXDROP_SERVICE=' + JSON.stringify(service));
    assert(served.includes(service), 'fixture must replace the bundled service URL');
    site = await start((req, res) => {
      if (req.method !== 'GET') { reject(req, res); return; }
      const url = new URL(req.url, siteOrigin);
      if (url.pathname === '/version.json') {
        current.versionRequests.push(Date.now());
        json(res, { build, feedback: service, serviceRevision: 1 }); return;
      }
      if (url.pathname !== '/' && url.pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(served);
    });
    siteOrigin = origin(site);
    const launch = { headless: true };
    if (process.env.BROWSER_EXECUTABLE_PATH) launch.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    else if (packed) {
      launch.executablePath = await packed.executablePath();
      launch.args = packed.args.filter(argument => argument !== '--single-process');
    }
    browser = await engine.launch(launch);

    async function scenario(name, cached, run) {
      current = { name, healthRequests: [], boardRequests: [], redirects: [], versionRequests: [], healthCompletedAt: null };
      const state = current;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => {
          const requested = new URL(route.request().url()).origin;
          if ([siteOrigin, relayOrigin, contentOrigin].includes(requested)) return route.continue();
          external.push(route.request().url()); return route.abort();
        });
        await context.addInitScript(({ build, service, cached }) => {
          localStorage.setItem('hexdrop.seen', '1');
          localStorage.setItem('hexdrop.patchNotesSeen', build);
          localStorage.setItem('hexdrop.installSeen', String(Date.now()));
          localStorage.setItem('hexdrop.count', '0');
          localStorage.setItem('hexdrop.metrics.enabled', '0');
          localStorage.setItem('hexdrop.muted', '1');
          // Deliberately do not seed hexdrop.service. version.json must save
          // its first same-URL configuration while discovery is still running.
          if (cached) localStorage.setItem('hexdrop.lb.caps', JSON.stringify({ url: service,
            boards: true, protocol: 2, build: 'b0', count: false, at: Date.now() }));
        }, { build, service, cached });
        const page = await context.newPage(); page.setDefaultTimeout(16000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(siteOrigin + '/');
        await page.locator('#mBoard').tap();
        await run(page, state);
      } finally { await context.close(); }
    }

    async function leaderboard(page) {
      await page.waitForFunction(() => document.querySelector('#lbPane')?.textContent.includes('local-delayed-health-leader'), {}, { timeout: 16000 });
    }
    async function healthFinished(page, state) {
      const deadline = Date.now() + 16000;
      while (!state.healthCompletedAt) {
        assert(Date.now() < deadline, 'fixture health response must finish'); await page.waitForTimeout(25);
      }
      await page.waitForTimeout(150);
    }
    await scenario('cold', false, async (page, state) => {
      await leaderboard(page);
      assert(state.healthCompletedAt, 'cold board must wait for the delayed capability response');
      assert.equal(state.healthRequests.length, 1, 'startup, cold open and same-URL config arrival must share one health request');
      assert.equal(state.boardRequests.length, 1, 'cold board appears without a retry or second tap');
      assert(state.healthCompletedAt - state.healthRequests[0].at >= HEALTH_DELAY_MS - 50, 'fixture must exceed the former six-second timeout');
      assert.deepEqual(state.redirects.filter(value => value !== 'content-board'), ['relay-exec', 'relay-redirect', 'content-health']);
      if (webBuild) {
        assert(state.versionRequests.length >= 1, 'normal startup version polling must run during discovery');
        assert(state.versionRequests[0] < state.healthCompletedAt, 'initial config must arrive before health discovery completes');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hexdrop.service')));
        assert.equal(stored.url, service); assert.equal(stored.revision, 1);
      }
      passed.push('cold discovery survives real redirects plus seven-second health and first same-URL configuration');
    });
    await scenario('returning', true, async (page, state) => {
      await leaderboard(page);
      assert.equal(state.healthCompletedAt, null, 'known positive capabilities must show the board before slow refresh finishes');
      assert.equal(state.boardRequests.length, 1);
      await healthFinished(page, state);
      assert.equal(state.healthRequests.length, 1, 'old-build capability refresh and same-URL config share one request');
      assert.equal(state.boardRequests.length, 1, 'background confirmation must not reload an already fresh board');
      passed.push('returning positive old-build capabilities display a board before health refresh, without duplicate reads');
    });
    assert.deepEqual(forbidden, [], 'public connectivity checks must not send POSTs or player IDs');
    assert.deepEqual(external, [], 'production and other external traffic must never be attempted');
    assert.deepEqual(errors, [], 'connectivity scenarios must finish without JavaScript errors');
    console.log(`PASS ${engineName} ${build}: ${passed.join('; ')}`);
    if (!webBuild) console.log('Native asset: delayed discovery and cached-capability cases apply; no web version polling is configured.');
  } finally {
    if (browser) await browser.close();
    for (const timer of timers) clearTimeout(timer);
    for (const server of [site, relay, content]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
