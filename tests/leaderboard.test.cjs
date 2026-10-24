const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
const section = (a, b) => {
  const start = html.indexOf(a), end = html.indexOf(b, start);
  assert(start >= 0 && end > start, a); return html.slice(start, end);
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const service = 'https://first.example/exec';
const board = (total = 0) => ({ ok: true, top: [], total, me: null });
const health = () => ({ json: async () => ({ ok: true, features: ['boards', 'count'], protocol: 2, countEventIds: true }) });
function app() {
  const db = new Map(), listeners = {}, scheduled = [];
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const c = {
    Promise, Date: Clock, Math, JSON, console, AbortController, setTimeout, clearTimeout,
    WEB: { feedback: service }, BUILD: html.match(/var BUILD\s*=\s*"([^"]+)"/)[1],
    LS: (k, d) => db.has(k) ? db.get(k) : d, SS: (k, v) => db.set(k, String(v)), DEL: k => db.delete(k),
    window: { fetch: true, addEventListener: (k, fn) => listeners[k] = fn }, navigator: { onLine: true },
    document: { hidden: false, addEventListener: (k, fn) => listeners[k] = fn }, $: () => null,
    MODE_ORDER: ['zen', 'hard', 'time'], MODES: { zen: { name: 'Zen' }, hard: { name: 'Hard' }, time: { name: 'Time Attack' } },
    powerUnlocked: () => false, mode: 'zen', bestOf: () => 0, toast: () => {}, fbBindOwners: () => {},
    fetch: async () => { throw Error('unexpected fetch'); }, countActive: () => {},
    newFeedbackId: () => 'random-test-id', tidyName: x => x, colorFor: () => '#FD9CBA'
  };
  vm.createContext(c);
  vm.runInContext(section('var RELAY_OK=', 'function paintWebRow()'), c);
  vm.runInContext(section('var LB_TZ=', '/* ============================ player numbers'), c);
  c.lbMode = 'zen';
  c.lbPut('hexdrop.lb.caps', { boards: true, protocol: 2, url: service, build: c.BUILD, at: now });
  c.read = key => db.has(key) ? JSON.parse(db.get(key)) : null;
  c.advance = ms => now += ms;
  c.listeners = listeners; c.scheduled = scheduled;
  c.captureBootTimers = () => {
    c.setTimeout = (fn, ms) => [1000, 1200, 3000].includes(ms) ? (scheduled.push({ fn, ms }), -1) : setTimeout(fn, ms);
  };
  return c;
}
function posts(c) {
  const pending = [];
  const defer = (body, endpoint) => new Promise((resolve, reject) => pending.push({ body, endpoint, resolve, reject }));
  c.lbPost = defer; c.lbReadBoard = defer;
  return pending;
}
function sheet(c) {
  const pane = { innerHTML: '' };
  const s = { isConnected: true, scrollTop: 0, querySelector: q => q === '#lbPane' ? pane : null, querySelectorAll: () => [] };
  s.pane = pane; return s;
}

test('cold opening waits for one shared capability check then loads one board', async () => {
  const c = app(), r = posts(c), s = sheet(c), gets = [];
  c.DEL('hexdrop.lb.caps');
  c.fetch = () => new Promise(resolve => gets.push(resolve));
  const first = c.lbLoad(s), second = c.lbLoad(s);
  await tick(); assert.equal(gets.length, 1); assert.equal(r.length, 0);
  assert.match(s.pane.innerHTML, /Checking the online leaderboards/);
  gets[0](health()); await tick(); assert.equal(r.length, 1);
  assert.match(s.pane.innerHTML, /Loading the board/);
  r[0].resolve(board()); await Promise.all([first, second]);
  assert.match(s.pane.innerHTML, /Saved just now/); assert.match(s.pane.innerHTML, /id="lbRetry"/);
});

test('cold health allows a redirected response arriving after six seconds', async () => {
  const c = app(), r = posts(c), s = sheet(c), timers = []; let finish;
  c.DEL('hexdrop.lb.caps'); c.fetch = () => new Promise(resolve => finish = resolve);
  c.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  const pending = c.lbLoad(s); await tick();
  assert(c.LB_HEALTH_MS >= 20000); assert.equal(timers[0].ms, c.LB_HEALTH_MS);
  c.advance(7000); assert.equal(r.length, 0);
  finish(health()); await tick(); assert.equal(r.length, 1);
  r[0].resolve(board()); assert((await pending).ok);
});

test('saving the same endpoint during startup does not invalidate its health request', async () => {
  const c = app(), r = posts(c), s = sheet(c); let finish;
  c.DEL('hexdrop.lb.caps'); c.fetch = () => new Promise(resolve => finish = resolve);
  const context = c.lbServiceContext(), pending = c.lbLoad(s); await tick();
  assert.equal(c.LS('hexdrop.service', ''), '');
  assert.equal(c.applyServiceConfig({ feedback: service, serviceRevision: 1 }), false);
  assert.equal(c.lbServiceContext(), context);
  finish(health()); await tick(); assert.equal(r.length, 1);
  r[0].resolve(board()); assert((await pending).ok);
});

test('an upgrade reads a known board immediately while refreshing old-build health', async () => {
  const c = app(), r = posts(c), s = sheet(c); let rejectHealth;
  c.lbPut('hexdrop.lb.caps', { boards: true, protocol: 2, url: service, build: 'b35', at: c.Date.now() });
  c.fetch = () => new Promise((resolve, reject) => rejectHealth = reject);
  const pending = c.lbLoad(s); assert.equal(r.length, 1); await tick();
  r[0].resolve(board()); assert((await pending).ok);
  rejectHealth(Error('transient health failure')); await tick();
  assert.equal(c.boardsReady(), true); assert.match(s.pane.innerHTML, /Saved just now/);
  const retry = c.lbLoad(s, true); assert.equal(r.length, 2); await tick();
  r[1].resolve(board()); assert((await retry).ok);
  rejectHealth(Error('transient health failure')); await tick();
});

test('background health can explicitly pause known boards and invalidate an in-flight read', async () => {
  const c = app(), r = posts(c), s = sheet(c);
  c.lbPut('hexdrop.lb.caps', { boards: true, protocol: 2, url: service, build: 'b35', at: c.Date.now() });
  c.fetch = async () => ({ json: async () => ({ ok: true, features: ['feedback'], protocol: 2 }) });
  const pending = c.lbLoad(s); assert.equal(r.length, 1); await tick();
  assert.equal(c.boardsReady(), false); r[0].resolve(board()); assert.equal(await pending, null);
  assert.equal(c.lbCached('zen', 'day'), null);
  assert.equal(await c.lbLoad(s), null); assert.equal(r.length, 1);
  assert.match(s.pane.innerHTML, /does not currently offer online leaderboards/);
});

test('capability timeout works without AbortController and ignores a late response', async () => {
  const c = app(), r = posts(c), s = sheet(c); let finish;
  c.DEL('hexdrop.lb.caps'); c.LB_HEALTH_MS = 10;
  c.fetch = () => new Promise(resolve => finish = resolve);
  assert.equal(await c.lbLoad(s), null);
  assert.equal(r.length, 0); assert.equal(c.read('hexdrop.lb.caps'), null);
  assert.doesNotMatch(s.pane.innerHTML, /Checking the online leaderboards/);
  finish(health()); await tick(); assert.equal(c.read('hexdrop.lb.caps'), null);
});

test('capability results cannot survive disable or a service A to B to A rotation', async () => {
  for (const disable of [false, true]) {
    const c = app(); let finish;
    c.DEL('hexdrop.lb.caps'); c.fetch = () => new Promise(resolve => finish = resolve);
    const pending = c.lbCheckService(); await tick();
    c.applyServiceConfig({ feedback: disable ? false : 'https://second.example/exec', serviceRevision: 1 });
    if (!disable) c.applyServiceConfig({ feedback: service, serviceRevision: 2 });
    finish(health()); assert.equal(await pending, false); assert.equal(c.read('hexdrop.lb.caps'), null);
  }
});

test('an unknown or explicitly disabled service never receives a board read', async () => {
  const c = app(), r = posts(c), s = sheet(c); let gets = 0;
  c.DEL('hexdrop.lb.caps'); c.fetch = async () => { gets++; return { json: async () => ({ ok: true }) }; };
  assert.equal(await c.lbLoad(s), null); assert.equal(r.length, 0);
  c.applyServiceConfig({ feedback: false, serviceRevision: 1 });
  assert.equal(await c.lbLoad(s, true), null); assert.equal(gets, 1); assert.equal(r.length, 0);
});

test('identical reads share one promise while full request context remains distinct', async () => {
  const c = app(), r = posts(c);
  const first = c.lbFetch('zen', 'day', 10), same = c.lbFetch('zen', 'day', 10, true);
  assert.equal(first, same); assert.equal(r.length, 1);
  const mode = c.lbFetch('hard', 'day', 10), period = c.lbFetch('zen', 'month', 10), probe = c.lbFetch('zen', 'day', 20);
  assert.equal(r.length, 4);
  r.forEach(x => x.resolve(board())); await Promise.all([first, mode, period, probe]);
  assert.equal(await first, null); assert.equal(c.lbCached('zen', 'day', 20).total, 0);
});

test('fresh saved copies reuse their timestamp; stale copies stay visible during refresh and failure', async () => {
  const c = app(), r = posts(c), s = sheet(c), first = c.lbFetch('zen', 'day');
  r[0].resolve(board()); await first;
  const savedAt = c.read('hexdrop.lb.cache.zen|day').at;
  c.advance(20000); assert((await c.lbFetch('zen', 'day')).ok); assert.equal(r.length, 1);
  assert.equal(c.read('hexdrop.lb.cache.zen|day').at, savedAt);
  c.advance(100001); const stale = c.lbLoad(s); await tick();
  assert.equal(r.length, 2); assert.match(s.pane.innerHTML, /Saved 2 minutes ago\. Updating/);
  r[1].reject(Error('offline')); await stale;
  assert.match(s.pane.innerHTML, /Saved 2 minutes ago\. Couldn’t update/);
  assert.doesNotMatch(s.pane.innerHTML, /id="lbRetry"[^>]*disabled/);
  assert.equal(c.read('hexdrop.lb.cache.zen|day').at, savedAt);
  // Reopening from persistent storage follows the same age rule.
  c.lbData = {}; c.lbContexts = {}; c.advance(1000);
  const reopen = c.lbFetch('zen', 'day'); assert.equal(r.length, 3); r[2].resolve(board()); await reopen;
});

test('Refresh bypasses a fresh saved copy but shares an already-running identical request', async () => {
  const c = app(), r = posts(c), first = c.lbFetch('zen', 'day'); r[0].resolve(board()); await first;
  const refresh = c.lbFetch('zen', 'day', 0, true), repeat = c.lbFetch('zen', 'day', 0, true);
  assert.equal(refresh, repeat); assert.equal(r.length, 2); r[1].resolve(board()); await refresh;
});

test('manual Refresh skips the board cache while reusing healthy capability data', async () => {
  const c = app(), r = posts(c), s = sheet(c); let gets = 0;
  c.fetch = async () => { gets++; return health(); };
  const first = c.lbLoad(s); await tick(); r[0].resolve(board()); await first;
  const refresh = c.lbLoad(s, true); await tick();
  assert.equal(gets, 0); assert.equal(r.length, 2); r[1].resolve(board()); await refresh;
  // An explicit paused capability can be rechecked by Refresh.
  c.lbPut('hexdrop.lb.caps', { boards: false, protocol: 2, url: service, build: c.BUILD, at: c.Date.now() });
  const paused = c.lbLoad(s, true); await tick(); assert.equal(gets, 1);
  assert.equal(r.length, 3); r[2].resolve(board()); await paused;
});

test('a cached probe rank is never reused for a different local score', async () => {
  const c = app(), r = posts(c), now = c.Date.now();
  c.lbRecord('zen', 10, now); const first = c.lbFetch('zen', 'day', 10);
  r[0].resolve({ ...board(), probe: { score: 10, rank: 1 } }); await first;
  assert(c.lbCached('zen', 'day')); c.lbRecord('zen', 20, now);
  assert.equal(c.lbCached('zen', 'day'), null);
  assert.doesNotMatch(c.lbWhereHTML({ ...board(), probe: { score: 10, rank: 1 } }), /would be #/);
  const second = c.lbFetch('zen', 'day', 20);
  r[1].resolve({ ...board(), probe: { score: 10, rank: 1 } }); assert.equal(await second, null);
});

test('a score acknowledgement invalidates saved data and pre-write in-flight responses', async () => {
  const c = app(), r = posts(c);
  c.lbPut('hexdrop.lb.me', { id: 'test-player', name: 'Player', color: '#FD9CBA', revision: 1, service });
  c.SS('hexdrop.lb.choice', 'in');
  const original = c.lbFetch('zen', 'day'); r[0].resolve(board()); await original;
  const oldRead = c.lbFetch('zen', 'day', 0, true);
  c.lbQueue({ mode: 'zen', score: 30, at: c.Date.now() }); c.lbSync();
  assert.equal(r[2].body.action, 'scores'); r[2].resolve({ ok: true }); await tick();
  assert.equal(c.lbCached('zen', 'day'), null); assert.equal(c.read('hexdrop.lb.cache.zen|day'), null);
  r[1].resolve(board()); assert.equal(await oldRead, null); assert.equal(c.lbCached('zen', 'day'), null);
});

test('a day or month rollover settles its own busy state without touching a newer read', async () => {
  for (const per of ['day', 'month']) {
    const c = app(), r = posts(c), name = per === 'day' ? 'lbDayKey' : 'lbMonthKey';
    const first = c.lbFetch('zen', per); c[name] = () => 'new-period';
    r[0].resolve(board()); assert.equal(await first, null); assert.equal(c.lbLoading['zen|' + per], false);
    const old = c.lbFetch('zen', per); c[name] = () => 'next-period'; const next = c.lbFetch('zen', per);
    const token = c.lbLoading['zen|' + per]; r[1].reject(Error('offline')); await old;
    assert.equal(c.lbLoading['zen|' + per], token); r[2].resolve(board()); await next;
  }
});

test('reconnect rechecks capabilities then retries the selected failed board', async () => {
  const c = app(), r = posts(c), s = sheet(c);
  c.$ = id => id === 'sheet' ? s : null;
  const original = c.lbFetch('zen', 'day'); r[0].resolve(board()); await original;
  const failed = c.lbLoad(s, true); await tick(); r[1].reject(Error('offline')); await failed;
  c.fetch = async () => health(); c.captureBootTimers(); c.lbBoot();
  c.listeners.online(); c.scheduled.find(x => x.ms === 1000).fn(); await tick(); await tick();
  assert.equal(r.length, 3); r[2].resolve(board()); await tick();
  assert.match(s.pane.innerHTML, /Saved just now/);
});

test('selected mode and period buttons do not start redundant loads', () => {
  const c = app(), loads = [];
  const tabs = ['day', 'month'].map(value => ({ getAttribute: () => value, setAttribute() {}, classList: { toggle() {} } }));
  const modes = ['zen', 'hard'].map(value => ({ getAttribute: () => value }));
  const s = { querySelector: q => q === '#lbTabs' ? { querySelectorAll: () => tabs } : null, querySelectorAll: () => modes };
  c.lbRefresh = () => {}; c.lbLoad = () => loads.push(c.lbMode + '|' + c.lbPeriod);
  c.wireBoard(s); tabs[0].onclick(); modes[0].onclick(); tabs[1].onclick(); tabs[1].onclick(); modes[1].onclick(); modes[1].onclick();
  assert.deepEqual(loads, ['zen|day', 'zen|month', 'hard|month']);
});

test('optional board metrics expose only bounded timing/context fields and cannot break reads', async () => {
  const c = app(), r = posts(c), events = [];
  c.recordBoardMetric = event => { events.push(event); throw Error('diagnostics failure'); };
  const first = c.lbFetch('zen', 'day'); r[0].resolve(board()); assert((await first).ok);
  assert((await c.lbFetch('zen', 'day')).ok);
  assert.deepEqual(events.map(x => x.outcome), ['network', 'cache']);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'mode', 'outcome', 'period']);
    assert(Number.isFinite(event.durationMs)); assert.equal(event.mode, 'zen'); assert.equal(event.period, 'day');
  }
});

test('board abort and timeout failures are classified separately from other errors', async () => {
  const c = app(), r = posts(c), outcomes = [];
  c.recordBoardMetric = event => outcomes.push(event.outcome);
  for (const name of ['AbortError', 'TimeoutError', 'TypeError']) {
    const pending = c.lbFetch('zen', 'day', 0, true);
    const error = new Error('mock failure'); error.name = name;
    r.at(-1).reject(error); assert.equal(await pending, null);
    assert.equal(c.lbLoading['zen|day'], false);
  }
  assert.deepEqual(outcomes, ['timeout', 'timeout', 'error']);
});

function joined(c) {
  c.lbPut('hexdrop.lb.me', { id: 'private-player-credential', name: 'Player', color: '#FD9CBA', revision: 1, service });
  c.SS('hexdrop.lb.choice', 'in');
}
test('anonymous board GETs contain only allowed filters and never a credential', async () => {
  const c = app(), requests = [];
  c.fetch = async (url, options) => { requests.push({ url: new URL(url), options }); return { json: async () => board() }; };
  assert((await c.lbPublicBoard({ mode: 'zen', period: 'month', probe: 42, id: 'must-not-escape', extra: 'ignored' }, service)).ok);
  const request = requests[0];
  assert.equal(request.options.method, 'GET'); assert.equal(request.options.body, undefined);
  assert.deepEqual([...request.url.searchParams.keys()], ['action', 'mode', 'period', 'probe']);
  assert.equal(request.url.searchParams.get('action'), 'board'); assert.equal(request.url.searchParams.get('probe'), '42');
  assert(!request.url.href.includes('must-not-escape')); assert.equal(request.options.redirect, 'follow');
});

test('a personal read keeps its player credential exclusively in the POST body', async () => {
  const c = app(), requests = []; joined(c);
  c.fetch = async (url, options) => { requests.push({ url, options }); return { json: async () => ({ ...board(), me: { rank: 1, score: 20, name: 'Player', color: '#FD9CBA' } }) }; };
  const result = await c.lbFetch('zen', 'day'); assert(result.me);
  assert.equal(requests.length, 1); assert.equal(requests[0].options.method, 'POST');
  assert.equal(JSON.parse(requests[0].options.body).id, 'private-player-credential');
  assert(!requests[0].url.includes('private-player-credential'));
});

test('failed or malformed personal reads fall back to an explicitly public-only cached board', async () => {
  for (const failure of ['network', 'timeout', 'health']) {
    const c = app(), requests = []; joined(c);
    c.fetch = async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (options.method === 'POST') {
        if (failure === 'health') return health();
        const error = new Error('transport failed'); error.name = failure === 'timeout' ? 'AbortError' : 'TypeError'; throw error;
      }
      return { json: async () => ({ ...board(1), top: [{ r: 1, n: 'Public player', c: '#FD9CBA', s: 100, me: true }], me: { rank: 1, score: 100, name: 'Public player', color: '#FD9CBA' } }) };
    };
    const result = await c.lbFetch('zen', 'day');
    assert.equal(requests.length, 2); assert.equal(requests[1].options.method, 'GET');
    assert.deepEqual([...requests[1].url.searchParams.keys()], ['action', 'mode', 'period']);
    assert(!requests[1].url.href.includes('private-player-credential'));
    assert.equal(result.personalUnavailable, true); assert.equal(result.me, null); assert.equal(result.top[0].me, false);
    assert.match(c.lbWhereHTML(result), /personal rank is temporarily unavailable/);
    assert.doesNotMatch(c.lbWhereHTML(result), /No score from you/);
    assert.equal(c.read('hexdrop.lb.cache.zen|day').d.personalUnavailable, true);
    assert.equal((await c.lbFetch('zen', 'day')).personalUnavailable, true); assert.equal(requests.length, 2);
  }
});

test('explicit personal board errors do not trigger an extra public request', async () => {
  for (const error of ['busy', 'disabled', 'not joined']) {
    const c = app(), requests = []; joined(c);
    c.fetch = async (url, options) => { requests.push({ url, options }); return { json: async () => ({ ok: false, error }) }; };
    assert.equal(await c.lbFetch('zen', 'day'), null);
    assert.equal(requests.length, 1); assert.equal(requests[0].options.method, 'POST');
  }
});

test('public fallback stops after membership, endpoint, period, or pause changes', async () => {
  for (const change of ['membership', 'endpoint', 'period', 'pause']) {
    const c = app(), requests = []; let rejectPost; joined(c);
    c.fetch = (url, options) => {
      requests.push({ url, options });
      assert.equal(options.method, 'POST', 'a stale failed POST must never start its fallback GET');
      return new Promise((resolve, reject) => rejectPost = reject);
    };
    const pending = c.lbFetch('zen', 'day');
    if (change === 'membership') { const me = c.lbMe(); me.revision++; c.lbPut('hexdrop.lb.me', me); }
    if (change === 'endpoint') c.applyServiceConfig({ feedback: 'https://second.example/exec', serviceRevision: 1 });
    if (change === 'period') c.lbDayKey = () => 'next-day';
    if (change === 'pause') { const caps = c.read('hexdrop.lb.caps'); caps.boards = false; c.lbPut('hexdrop.lb.caps', caps); }
    rejectPost(Error('transport failed'));
    assert.equal(await pending, null); assert.equal(requests.length, 1); assert.equal(c.lbCached('zen', 'day'), null);
  }
});

test('an anonymous GET returning health data is still rejected as an invalid board', async () => {
  const c = app(); let reads = 0;
  c.fetch = async () => { reads++; return health(); };
  assert.equal(await c.lbFetch('zen', 'day'), null); assert.equal(reads, 1);
  assert.equal(c.read('hexdrop.lb.cache.zen|day'), null);
});
