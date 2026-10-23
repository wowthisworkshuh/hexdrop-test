const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_METRICS_MODULE || process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
const first = html.indexOf('// HEXDROP_METRICS_START'), last = html.indexOf('// HEXDROP_METRICS_END', first);
assert(first >= 0 && last > first, 'the actual bundled local metrics module must exist');
const source = html.slice(first, last);
const KEY = 'hexdrop.metrics.v1', PREF = 'hexdrop.metrics.enabled', DAY = 86400000;

function fixture(options = {}) {
  let wall = options.wall || Date.UTC(2026, 9, 23, 12), monotonic = 0;
  const db = options.db || new Map(), reads = [], writes = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const math = Object.create(Math); math.random = () => { throw Error('metrics must not consume gameplay RNG'); };
  const c = {
    Date: Clock, Math: math, performance: { now: () => monotonic },
    navigator: { globalPrivacyControl: !!options.gpc }, document: { hidden: false },
    localStorage: {
      getItem(key) { reads.push(key); if (options.failStorage) throw Error('blocked storage'); return db.get(key) ?? null; },
      setItem(key, value) { if (options.failStorage) throw Error('blocked storage'); writes.push(key); db.set(key, value); }
    },
    fetch() { throw Error('local metrics must not make network requests'); },
    setTimeout() { throw Error('local metrics must not schedule frame writes'); },
    setInterval() { throw Error('local metrics must not schedule background work'); }
  };
  c.window = c; vm.createContext(c); vm.runInContext(source, c);
  const api = c.HexDropMetrics; api.configure({ build: 'b36', platform: 'ios-web' });
  return { c, api, db, reads, writes,
    tick(ms, wallMs = ms) { monotonic += ms; wall += wallMs; },
    day() { return new Clock().toISOString().slice(0, 10); },
    today() { return api.snapshot().days[this.day()]; }
  };
}
function total(snapshot, key) { return Object.values(snapshot.days).reduce((n, day) => n + day[key], 0); }

test('one page session records coarse build/platform adoption without reading unrelated storage', () => {
  const f = fixture(); f.api.sessionStart(); f.api.sessionStart();
  const s = f.api.snapshot(), d = s.days[f.day()];
  assert.equal(d.sessions, 1); assert.equal(d.builds.b36, 1); assert.equal(d.platforms['ios-web'], 1);
  assert.equal(s.firstSeenDay, f.day()); assert.equal(s.activeDays, 1);
  assert.equal(s.collectionEnabled, true); assert.equal(s.transportAllowed, false); assert.equal(f.api.canSend(), false);
  assert(f.reads.every(key => key === KEY || key === PREF));
  assert(f.writes.every(key => key === KEY || key === PREF));
  assert.equal(s.run, undefined, 'internal run bookkeeping stays out of the report');
});

test('foreground durations use monotonic time, exclude pauses and tolerate repeated resumes', () => {
  const f = fixture(); f.api.sessionStart();
  f.tick(1000); f.api.sessionResume(); f.tick(500); f.api.sessionPause();
  assert.equal(f.today().activeMs, 1500);
  f.tick(60000); f.api.sessionPause(); assert.equal(f.today().activeMs, 1500);
  f.c.document.hidden = true; f.api.sessionResume(); f.tick(10000);
  assert.equal(f.today().activeMs, 1500);
  f.c.document.hidden = false; f.api.sessionResume(); f.tick(250, 600250);
  assert.equal(f.today().activeMs, 1750, 'wall-clock changes do not manufacture active time');
});

test('foreground time spanning UTC midnight is divided between its actual day buckets', () => {
  const f = fixture({ wall: Date.UTC(2026, 9, 23, 23, 59, 59) }); f.api.sessionStart();
  f.tick(2000); f.api.sessionPause(); const s = f.api.snapshot();
  assert.equal(s.days['2026-10-23'].activeMs, 1000); assert.equal(s.days['2026-10-24'].activeMs, 1000);
  assert.equal(s.activeDays, 2); assert.equal(s.dayCohorts[1].cohortDay, 1);
});

test('revived game-over updates one logical run instead of double-counting its end or score', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'zen' });
  f.api.runEnded({ mode: 'zen', score: 100 }); f.api.runEnded({ mode: 'zen', score: 180 });
  f.api.runEnded({ mode: 'zen', score: 150 });
  let d = f.today();
  assert.equal(d.runStarts, 1); assert.equal(d.runEnds, 1); assert.equal(d.modes.zen.scoreTotal, 180);
  assert.equal(d.modes.zen.scoreMax, 180); assert.equal(d.modes.zen.activeMs, undefined);
  f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'zen', score: 50 }); d = f.today();
  assert.equal(d.runStarts, 2); assert.equal(d.runEnds, 2); assert.equal(d.modes.zen.scoreTotal, 230);
});

test('every explicit Continue counts a restore without creating a new logical run start', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'hard' });
  f.api.runResume({ mode: 'hard' }); f.api.runResume({ mode: 'hard' });
  assert.equal(f.today().runStarts, 1); assert.equal(f.today().runRestores, 2);
  const reload = fixture({ db: f.db }); reload.api.sessionStart(); reload.api.runResume({ mode: 'hard' });
  reload.api.runEnded({ mode: 'hard', score: 300 });
  const d = reload.today(); assert.equal(d.runStarts, 1); assert.equal(d.runRestores, 3); assert.equal(d.runEnds, 1);
});

test('persisted ended-run bookkeeping prevents duplicate endings after reload and revival', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'power' }); f.api.runEnded({ mode: 'power', score: 80 });
  const reload = fixture({ db: f.db }); reload.api.sessionStart(); reload.api.runResume({ mode: 'power' });
  reload.api.runEnded({ mode: 'power', score: 120 });
  const d = reload.today(); assert.equal(d.runEnds, 1); assert.equal(d.modes.power.scoreTotal, 120);
});

test('load diagnostics separate cached hits, successful latency and failed latency', () => {
  const f = fixture(); f.api.sessionStart();
  for (const args of [{ outcome: 'cache', durationMs: 2 }, { outcome: 'network', durationMs: 800 },
    { outcome: 'network', durationMs: 1200 }, { outcome: 'error', durationMs: 300 }, { outcome: 'timeout', durationMs: 15000 }]) f.api.board(args);
  const b = f.today().boards;
  assert.equal(b.cache, 1); assert.equal(b.network, 2); assert.equal(b.error, 1); assert.equal(b.timeout, 1);
  assert.equal(b.networkMs, 2000); assert.equal(b.networkMaxMs, 1200); assert.equal(b.errorMs, 15300); assert.equal(b.errorMaxMs, 15000);
  f.api.tutorialComplete();
  const report = f.api.textReport();
  assert.match(report, /stored on this device/); assert.match(report, /foreground minutes/);
  assert.match(report, /1 tutorial confirmations/); assert.match(report, /average 1000 ms, max 1200 ms/);
  assert.match(report, /average 7650 ms, max 15000 ms/); assert.match(report, /ended at least once/);
});

test('frame sampling aggregates only in memory and never consumes RNG, storage or network per frame', () => {
  const f = fixture(); f.api.sessionStart(); f.writes.length = 0;
  for (let n = 0; n < 60; n++) f.api.recordFrame(16);
  for (let n = 0; n < 6; n++) f.api.recordFrame(50);
  for (let n = 0; n < 6; n++) f.api.recordFrame(150);
  assert.equal(f.writes.length, 0);
  const frames = f.today().frames;
  assert.equal(frames.samples, 12); assert.equal(frames.slow, 2); assert.equal(frames.verySlow, 1); assert.equal(frames.maxMs, 150);
  f.api.sessionPause(); for (let n = 0; n < 60; n++) f.api.recordFrame(150);
  assert.equal(f.today().frames.samples, 12);
});

test('opt-out persists, stops collection across reload, and keeps existing diagnostics until clear', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'time' }); f.tick(500); f.api.setEnabled(false);
  const before = f.api.snapshot(); f.tick(50000); f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'time', score: 80 });
  f.api.tutorialComplete(); f.api.board({ outcome: 'network', durationMs: 50 });
  assert.deepEqual(f.api.snapshot().days, before.days);
  const reload = fixture({ db: f.db }); reload.api.sessionStart(); reload.api.runResume({ mode: 'time' });
  assert.equal(reload.api.snapshot().collectionEnabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(reload.api.snapshot().days)), JSON.parse(JSON.stringify(before.days)));
  reload.api.clear(); assert.equal(Object.keys(reload.api.snapshot().days).length, 0);
});

test('Global Privacy Control prevents both default collection and explicit reenable', () => {
  const f = fixture({ gpc: true }); f.api.sessionStart(); f.api.setEnabled(true);
  f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'zen', score: 12 });
  f.api.board({ outcome: 'cache' }); f.api.tutorialComplete();
  for (let n = 0; n < 60; n++) f.api.recordFrame(120);
  const s = f.api.snapshot(); assert.equal(s.collectionEnabled, false); assert.equal(s.transportAllowed, false);
  assert.equal(Object.keys(s.days).length, 0); assert.equal(s.firstSeenDay, '');
  assert.match(f.api.textReport(), /Global Privacy Control: on/);
});

test('reenabling collection counts a session that began while opted out only once', () => {
  const db = new Map([[PREF, '0']]), f = fixture({ db }); f.api.sessionStart();
  f.api.setEnabled(true); f.api.setEnabled(true); f.tick(100); f.api.sessionPause();
  assert.equal(f.today().sessions, 1); assert.equal(f.today().activeMs, 100);
});

test('runs started while opted out cannot mutate a previously ended run after reenabling', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'zen', score: 100 });
  f.api.setEnabled(false); f.api.runStart({ mode: 'zen' }); f.api.setEnabled(true);
  f.api.runEnded({ mode: 'zen', score: 50 });
  const d = f.today(); assert.equal(d.runStarts, 1); assert.equal(d.runEnds, 2); assert.equal(d.modes.zen.scoreTotal, 150);
});

test('28-day retention keeps the original cohort and bounded build metadata', () => {
  let f = fixture(), firstDay = f.day();
  for (let day = 0; day < 40; day++) {
    if (day) f = fixture({ db: f.db, wall: Date.UTC(2026, 9, 23 + day, 12) });
    f.api.sessionStart(); f.api.sessionPause();
  }
  for (let build = 1; build <= 20; build++) {
    f = fixture({ db: f.db, wall: Date.UTC(2026, 9, 62, 12) });
    f.api.configure({ build: `b${build}`, platform: 'ios-web' }); f.api.sessionStart(); f.api.sessionPause();
  }
  const s = f.api.snapshot(); assert.equal(Object.keys(s.days).length, 28); assert.equal(s.activeDays, 40); assert.equal(s.firstSeenDay, firstDay);
  assert.equal(s.dayCohorts[0].cohortDay, 12); assert.equal(s.dayCohorts.at(-1).cohortDay, 39);
  assert(Object.values(s.days).every(d => Object.keys(d.builds).length <= 8));
  assert(Buffer.byteLength(f.db.get(KEY)) < 131072);
});

test('malformed or unavailable storage cannot break gameplay hooks', () => {
  for (const options of [{ db: new Map([[KEY, '{broken']]) }, { failStorage: true }, { db: new Map([[KEY, 'x'.repeat(140000)]]) }]) {
    const f = fixture(options);
    assert.doesNotThrow(() => { f.api.sessionStart(); f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'zen', score: NaN }); f.api.snapshot(); f.api.clear(); });
  }
});

test('snapshot copies cannot mutate internal counters and clear removes old aggregate history', () => {
  const f = fixture(); f.api.sessionStart(); f.api.runStart({ mode: 'zen' }); f.api.runEnded({ mode: 'zen', score: 77 });
  const s = f.api.snapshot(); s.days[f.day()].runStarts = 999;
  assert.equal(f.today().runStarts, 1);
  f.api.clear(); const cleared = f.api.snapshot();
  assert.equal(total(cleared, 'runStarts'), 0); assert.equal(total(cleared, 'runEnds'), 0); assert.equal(total(cleared, 'sessions'), 0);
});
