const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function applyMerges(groups,now){');
const end = html.indexOf('function boardClear(', start);
assert(start >= 0 && end > start, 'actual merge scoring must exist');
// Since b38 the speed window is measured in the player's own time (speedIdle), which the
// frame loop only advances while the board waits for the player.
const WINDOW = Number((html.match(/var SPEED_WINDOW = (\d+);/) || [])[1]);

// Exercise real three-tile scoring; replace only graphics, audio and board movement.
function game(lastMergeAt = 0, speedStreak = 0, speedIdle = 0) {
  const c = {
    Math, lastMergeAt, speedStreak, speedIdle, SPEED_WINDOW: WINDOW, COLS: 6, POWER_CAP: 4,
    TOPTIER: 4, JUMP_AT: 6, chain: 0, combo: 1, score: 0, focusId: 3,
    cols: [[{ id: 1, vy: 0 }, { id: 2, vy: 1 }, { id: 3, vy: 2 }], [], [], [], [], []],
    maxHeight: () => 3, powersOnBoard: () => 0, cx: x => x,
    particles: [], COLOR: ['#FFFFFF', '#FFFFFF'], R: 10,
    burst() {}, addFx() {}, earnedPower: () => null, compactColumns() {},
    floatText() {}, compactNum: String, M: { timed: false }, mode: 'zen',
    stats: { merges: 0, maxCascade: 0 }, sfxBloom() {}, sfxBreak() {},
    sfxForge() {}, explainOnce() {}, buzz() {}
  };
  vm.createContext(c); vm.runInContext(html.slice(start, end), c);
  c.merge = now => c.applyMerges([{ tier: 0, cells: [[0, 0], [0, 1], [0, 2]] }], now);
  return c;
}

test('the speed window is 2 seconds of the player\'s own time', () => {
  assert.equal(WINDOW, 2000);
});

test('a first merge never receives a speed bonus based on page uptime', () => {
  for (const now of [100, 3400, 4000, 100000]) {
    const c = game(), result = c.merge(now);
    assert.equal(result.gained, 36); assert.equal(result.speed, 0);
    assert.equal(c.lastMergeAt, now); assert.equal(c.speedIdle, 0);
  }
});

test('merges with little of the player\'s own time between them build the multiplier', () => {
  const c = game();
  assert.equal(c.merge(500).gained, 36);
  c.speedIdle = 900; assert.equal(c.merge(9000).gained, 43);    // a long fall and cascade, little thinking: still fast
  c.speedIdle = WINDOW - 1; assert.equal(c.merge(20000).gained, 50);
  assert.equal(c.speedStreak, 2);
});

test('a full window of the player\'s own time resets the streak, including its exact boundary', () => {
  for (const idle of [WINDOW, WINDOW + 1, 10000]) {
    const c = game(1000, 4, idle), result = c.merge(1200);
    assert.equal(result.gained, 36); assert.equal(result.speed, 0);
  }
});

test('clock values restored after a reload keep valid history', () => {
  // a restored run keeps the player's own time since its last merge; the page clock itself
  // may start anywhere, negative values included
  const recent = game(-2000, 1, 500), expired = game(-4000, 1, WINDOW + 500);
  assert.equal(recent.merge(500).gained, 50);
  assert.equal(recent.speedStreak, 2);
  assert.equal(expired.merge(500).gained, 36);
  assert.equal(expired.speedStreak, 0);
});
