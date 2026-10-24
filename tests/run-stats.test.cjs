const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
function section(a, b) {
  const start = html.indexOf(a), end = html.indexOf(b, start);
  assert(start >= 0 && end > start, a); return html.slice(start, end);
}
function app(initial = {}) {
  const db = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const effects = { endings: 0, submissions: 0, boards: 0 };
  const modes = { zen: { name: 'Zen', tiers: 5, pool: 3 }, hard: { name: 'Hard', tiers: 6, pool: 3 } };
  const c = {
    console, Math, JSON, Number, Object, Array, isFinite,
    stats: { runs: 0, lifetime: 0, bestRun: 0, longestTimed: 0, fired: {} }, badges: {},
    TRACK: [], screen: 'game', score: 0, mode: 'zen', M: modes.zen, MODES: modes,
    COLS: 6, MAXH: 10, TOPTIER: 4, POWERS: {}, PQ_MAX: 20, PQ_WINDOW_MS: 2500,
    cols: Array.from({ length: 6 }, () => []), uid: 0, best: 0, combo: 0, chain: 0,
    bag: [0, 1, 2, 0], held: null, runBadges: [], playMs: 0, sheetSince: -1, awaySince: -1,
    particles: [], mergedThisDrop: false, performance: { now: () => 5000 }, pq: [], pqHead: null, pqTaps: [], pcombo: null,
    LS: (k, d) => db.has(k) ? db.get(k) : d, SS: (k, v) => db.set(k, String(v)), DEL: k => db.delete(k),
    window: { HexDropMetrics: { runStart() {}, runResume() {}, runEnded() { effects.endings++; } } },
    makeCell(tier, power) { return { tier, power, id: ++c.uid, vy: 0 }; },
    resetPowers() { c.pq = []; c.pqHead = null; c.pqTaps = []; c.pcombo = null; },
    refillBag() { while (c.bag.length < 4) c.bag.push(0); },
    riseEvery: () => 10, seedBoard() {}, paintChips() {}, paintScore() {}, hideCombo() {},
    checkBadges() {}, sfxOver() {}, buzz() {}, showGameOver() {}, sfxBloom() {}, hideVeil() {}, cx: x => x * 10,
    submitScore() { effects.submissions++; }, lbAfterRun() { effects.boards++; }
  };
  c.bestOf = mode => parseInt(c.LS('hexdrop.best.' + mode, '0'), 10) || 0;
  vm.createContext(c);
  vm.runInContext(section('function lifetimeNow(){', 'function trackCount(){'), c);
  vm.runInContext(section('var trackSeen={};', 'function checkTrack(){'), c);
  vm.runInContext(section('function loadProgress(){', 'function hasBadge('), c);
  vm.runInContext(section('var hoverCol =', 'var styleKey ='), c);
  vm.runInContext(section('var SAVE="hexdrop.run.v2";', '/* ============================ effects'), c);
  c.loadProgress(); c.db = db; c.effects = effects;
  c.read = key => db.has(key) ? JSON.parse(db.get(key)) : null;
  c.putSave = saved => c.SS(c.SAVE, JSON.stringify(saved));
  return c;
}
const saved = extra => ({ v: 3, mode: 'zen', score: 150, cols: [[], [], [], [], [], []], bag: [0, 1, 2, 0], revived: true, ...extra });
function resume(c, run) { c.putSave(run); const valid = c.hasSave(); assert(valid, 'fixture must be a valid saved run'); c.restoreRun(valid); }

test('one logical run credits only additional points after revival and ignores repeated end callbacks', () => {
  const c = app(); c.newRun(); c.score = 100;
  assert.equal(c.lifetimeNow(), 100); assert.equal(c.stats.runs, 0); assert.equal(c.stats.lifetime, 0);
  c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 100);
  c.revive(); assert.equal(c.lifetimeNow(), 100, 'revival must not add the already credited first score again');
  c.score = 150; assert.equal(c.lifetimeNow(), 150);
  c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 150); assert.equal(c.stats.bestRun, 150);
  c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 150);
  assert.deepEqual(c.effects, { endings: 2, submissions: 2, boards: 2 });
});

test('zero-score first top-out counts once and later revival points are credited', () => {
  const c = app(); c.newRun(); c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 0);
  c.revive(); c.score = 50; c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 50);
});

test('saving and reloading before the first top-out keeps the score uncredited until the end', () => {
  const c = app(); c.newRun(); c.score = 100; c.saveRun();
  const raw = c.read(c.SAVE); assert.equal(raw.runRecorded, false); assert.equal(raw.runCredited, 0);
  const reloaded = app(Object.fromEntries(c.db)); reloaded.restoreRun(reloaded.hasSave());
  assert.equal(reloaded.lifetimeNow(), 100); assert.equal(reloaded.stats.lifetime, 0);
  reloaded.endRun(); assert.equal(reloaded.stats.runs, 1); assert.equal(reloaded.stats.lifetime, 100);
});

test('a revived save retains exact credited points across reload and final top-out', () => {
  const c = app(); c.newRun(); c.score = 100; c.endRun(); c.revive(); c.score = 150; c.saveRun();
  const raw = c.read(c.SAVE); assert.equal(raw.runRecorded, true); assert.equal(raw.runCredited, 100);
  const reloaded = app(Object.fromEntries(c.db)); reloaded.restoreRun(reloaded.hasSave());
  assert.equal(reloaded.stats.lifetime, 100); assert.equal(reloaded.lifetimeNow(), 150);
  reloaded.endRun(); assert.equal(reloaded.stats.runs, 1); assert.equal(reloaded.stats.lifetime, 150);
  assert.equal(reloaded.hasSave(), null);
  const again = app(Object.fromEntries(reloaded.db)); assert.equal(again.hasSave(), null);
  assert.equal(again.stats.runs, 1); assert.equal(again.stats.lifetime, 150);
});

test('a new run resets its ledger without discarding previously credited lifetime points', () => {
  const c = app(); c.newRun(); c.score = 100; c.endRun(); c.revive();
  c.setMode('hard'); c.newRun(); c.score = 50;
  assert.equal(c.runRecorded, false); assert.equal(c.runCredited, 0); assert.equal(c.lifetimeNow(), 150);
  c.endRun(); assert.equal(c.stats.runs, 2); assert.equal(c.stats.lifetime, 150);
  assert.equal(c.read('hexdrop.best.hard'), 50);
});

test('saved ledgers require a complete boolean flag and finite nonnegative credit bounded by score', () => {
  const c = app();
  const invalid = [
    { runRecorded: true }, { runCredited: 10 }, { runRecorded: 'true', runCredited: 10 },
    { runRecorded: true, runCredited: '10' }, { runRecorded: true, runCredited: null },
    { runRecorded: true, runCredited: -1 }, { runRecorded: true, runCredited: 151 },
    { runRecorded: false, runCredited: 10 }, { runRecorded: null, runCredited: 0 },
    { runRecorded: true, runCredited: Infinity }, { runRecorded: true, runCredited: NaN }
  ];
  for (const ledger of invalid) { c.putSave(saved(ledger)); assert.equal(c.hasSave(), null, JSON.stringify(ledger)); }
  for (const ledger of [{ runRecorded: false, runCredited: 0 }, { runRecorded: true, runCredited: 0 }, { runRecorded: true, runCredited: 100 }, { runRecorded: true, runCredited: 150 }]) {
    c.putSave(saved(ledger)); assert(c.hasSave(), JSON.stringify(ledger));
  }
});

test('an ordinary legacy saved run still credits its full score once', () => {
  const c = app({ 'hexdrop.stats': { runs: 3, lifetime: 200 } }); resume(c, saved({ revived: false }));
  assert.equal(c.runRecorded, false); assert.equal(c.runCredited, 0); assert.equal(c.lifetimeNow(), 350);
  c.endRun(); assert.equal(c.stats.runs, 4); assert.equal(c.stats.lifetime, 350);
});

test('legacy revived saves use stored first-score evidence without changing old totals', () => {
  const c = app({ 'hexdrop.stats': { runs: 1, lifetime: 100 }, 'hexdrop.best.zen': '100' });
  resume(c, saved()); assert.equal(c.runRecorded, true); assert.equal(c.runCredited, 100);
  assert.equal(c.stats.lifetime, 100); assert.equal(c.lifetimeNow(), 150);
  c.saveRun(); assert.equal(c.read(c.SAVE).runCredited, 100);
  c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 150);
});

test('ambiguous legacy revival credit uses a conservative baseline and preserves historical totals', () => {
  const c = app({ 'hexdrop.stats': { runs: 5, lifetime: 1000 }, 'hexdrop.best.zen': '500' });
  resume(c, saved()); assert.equal(c.runCredited, 150); assert.equal(c.stats.lifetime, 1000);
  c.score = 200; assert.equal(c.lifetimeNow(), 1050); c.endRun();
  assert.equal(c.stats.runs, 5); assert.equal(c.stats.lifetime, 1050);
});

test('legacy best evidence is optional, validated, and can bound a zero-score first top-out', () => {
  for (const best of [undefined, 'invalid', '', 'Infinity', '-1']) {
    const initial = { 'hexdrop.stats': { runs: 3, lifetime: 300 } };
    if (best !== undefined) initial['hexdrop.best.zen'] = best;
    const c = app(initial); resume(c, saved()); assert.equal(c.runCredited, 150);
  }
  const zero = app({ 'hexdrop.stats': { runs: 3, lifetime: 300 }, 'hexdrop.best.zen': '0' });
  resume(zero, saved()); assert.equal(zero.runRecorded, true); assert.equal(zero.runCredited, 0);
  zero.endRun(); assert.equal(zero.stats.runs, 3); assert.equal(zero.stats.lifetime, 450);
});

test('legacy revival with missing statistics starts uncredited instead of losing its final score', () => {
  const c = app(); resume(c, saved()); assert.equal(c.runRecorded, false); assert.equal(c.runCredited, 0);
  c.endRun(); assert.equal(c.stats.runs, 1); assert.equal(c.stats.lifetime, 150);
});

test('existing inflated totals and previously awarded cosmetics are never rolled back', () => {
  const c = app({ 'hexdrop.stats': { runs: 2, lifetime: 250 }, 'hexdrop.best.zen': '150', 'hexdrop.track': { '250000': 1 } });
  resume(c, saved()); c.endRun(); assert.equal(c.stats.runs, 2); assert.equal(c.stats.lifetime, 250);
  assert.equal(c.trackReached({ score: 250000 }), true); assert.equal(c.trackReached({ score: 750000 }), false);
  c.DEL('hexdrop.track'); const reset = app(Object.fromEntries(c.db));
  assert.equal(reset.trackReached({ score: 250000 }), false, 'clearing earned flags and reloading still resets cosmetic progress');
});
