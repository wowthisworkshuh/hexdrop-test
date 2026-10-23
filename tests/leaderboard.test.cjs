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
  c.lbPost = (body, endpoint) => new Promise((resolve, reject) => pending.push({ body, endpoint, resolve, reject }));
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
