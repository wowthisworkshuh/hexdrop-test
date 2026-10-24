// b38's pace, on the whole game with real frames: the visible fall, cascade steps shown
// before they merge, live's tap rule plus the double-tap guard, the FAST clock counting
// only the player's own time, and Time Attack's floor clock slowing while tiles move.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./game-harness.cjs');
const G = loadGame();
const { T } = G;
const cascadeBoard = () => { G.board([[0, 1], [0, 1], [], [], [], []]); T.bag = [0, 0, 0, 0]; };

test('a dropped tile falls an empty column in about a third of a second, speeding up', () => {
  G.fresh(); G.board([[], [], [], [], [], []]); T.bag = [0, 1, 2, 3];
  T.drop(2); const t0 = G.now;
  G.until(() => { const c = T.cols[2][0]; return c && Math.abs(c.vy - T.cy(2, 0)) < 0.6; });
  const fall = G.now - t0;
  assert(fall >= 290 && fall <= 390, 'fall took ' + fall + ' ms');
  G.fresh(); G.board([[], [], [], [], [], []]); T.bag = [0, 1, 2, 3]; T.drop(3);
  const y0 = T.cols[3][0].vy, yEnd = T.cy(3, 0), tS = G.now; let tHalf = 0;
  G.until(() => { if (!tHalf && T.cols[3][0].vy >= (y0 + yEnd) / 2) tHalf = G.now - tS; return Math.abs(T.cols[3][0].vy - yEnd) < 0.6; });
  assert(tHalf > (G.now - tS) * 0.6, 'half way after ' + tHalf + ' of ' + (G.now - tS) + ' ms');
});

test('the match merges straight away; only the cascade it sets off is shown, then merges', () => {
  G.fresh(); cascadeBoard(); T.drop(2); T.focusId = 0;
  let landedAt = 0, mergedAt = 0, linkedFirst = false; const s0 = T.score;
  G.until(() => {
    const c = T.cols[2][0];
    if (!landedAt && c && Math.abs(c.vy - T.cy(2, 0)) < 0.6) landedAt = G.now;
    if (T.state === 'linking' && T.score === s0) linkedFirst = true;
    if (T.score > s0) { mergedAt = G.now; return true; } return false;
  });
  assert(!linkedFirst, 'the first match must not glow');
  assert(mergedAt - landedAt <= 90, (mergedAt - landedAt) + ' ms from landing to merge');
  assert(G.until(() => T.state === 'linking'), 'the cascade lights up');
  assert.equal(T.linkGroups.length, 1); assert.equal(T.linkGroups[0].cells.length, 3);
  const ls = G.now, s1 = T.score;
  assert(G.until(() => T.state !== 'linking'));
  assert(G.now - ls >= T.PACE.link + T.PACE.slide - 20, 'shown for ' + (G.now - ls) + ' ms');
  assert(T.score > s1, 'then it merges and scores');
  G.idle();
  assert.equal(T.score, 7511, 'same score as b37 for the same cascade');
  assert.equal(JSON.stringify(T.cols.map(a => a.map(c => c.tier))), '[[],[],[],[],[],[]]');
  G.fresh(); G.board([[0], [0], [], [], [], []]); T.bag = [0, 1, 1, 1]; T.drop(2); T.focusId = 0;
  let linked = false; G.until(() => { if (T.state === 'linking') linked = true; return T.state === 'idle'; });
  assert(!linked && T.combo === 0, 'a plain match with no cascade never glows');
});

test('as in b37 a tap only drops once the board has stopped, and a double tap drops once', () => {
  G.fresh(); cascadeBoard(); T.drop(2); T.focusId = 0;
  G.until(() => T.state === 'linking');
  const d0 = T.drops;
  assert.equal(T.drop(4), false); assert.equal(T.drops, d0);
  G.idle();
  assert.equal(T.drop(4), true); assert.equal(T.drops, d0 + 1);
  G.fresh(); G.board([[], [], [], [], [], []]); T.bag = [0, 1, 2, 3];
  const dd = T.drops; T.drop(1); T.state = 'idle';          // as if the tile had landed at once
  assert.equal(T.drop(3), false, 'a second tap within ' + T.DOUBLE_TAP_MS + ' ms is an accidental double tap');
  G.tick(T.DOUBLE_TAP_MS + 10); T.state = 'idle';
  assert.equal(T.drop(3), true); assert.equal(T.drops, dd + 2);
});

test('the FAST streak counts only the player\'s own time, with a 2 second window', () => {
  assert.equal(T.SPEED_WINDOW, 2000);
  G.fresh(); G.board([[0, 0], [1, 1], [], [], [], []]); T.bag = [0, 1, 0, 1];
  T.drop(0); const before = T.speedIdle; G.until(() => T.state === 'idle');
  assert(T.speedIdle - before < 40, (T.speedIdle - before) + ' ms counted while tiles moved');
  const w = G.now; G.until(() => G.now - w >= 500, 100);
  assert(T.speedIdle >= 450, 'and it runs while the board waits: ' + T.speedIdle + ' ms');
  const mergeNow = () => { G.board([[], [0], [], [0], [], []]); T.bag = [0, 1, 2, 3]; T.drop(2); T.focusId = 0; G.idle(); };
  G.fresh(); mergeNow(); G.wait(1900); mergeNow();
  assert.equal(T.speedStreak, 1, 'a merge 1.9 s of thinking after the last keeps the streak');
  G.wait(2100); mergeNow();
  assert.equal(T.speedStreak, 0, 'a merge 2.1 s after the last starts over');
  assert.match(T.termByKey('fast').def, /within two seconds/);
  assert.match(T.termByKey('fast').def, /Only your own time counts/);
});

test('Time Attack: the floor clock runs at full speed while you think and at 40% while tiles move', () => {
  assert.equal(T.FLOOR_MOVING_RATE, 0.4);
  G.fresh('time'); G.board([[1, 2], [3, 4], [], [1, 2], [3, 4], [2]]);
  let left0 = T.riseAtMs - G.now; G.wait(1000);
  let used = left0 - (T.riseAtMs - G.now);
  assert(Math.abs(used - 1000) < 20, used + ' ms of clock for 1000 ms of thinking');
  G.board([[1, 2], [3, 4], [], [1, 2], [3, 4], [2]]); T.bag = [0, 1, 2, 3];   // no match and no board clear
  left0 = T.riseAtMs - G.now; const t0 = G.now; T.drop(2); let moving = 0;
  G.until(() => { if (T.state !== 'idle') moving += 17; return T.state === 'idle'; });
  used = left0 - (T.riseAtMs - G.now);
  const expected = (G.now - t0 - moving) + moving * 0.4;
  assert(moving > 200, 'the tile fell for ' + moving + ' ms');
  assert(Math.abs(used - expected) < 40, moving + ' ms of moving tiles cost ' + Math.round(used) + ' ms (expected ' + Math.round(expected) + ')');
  assert.match(T.riseLine('time'), /clock slows down/);
});

test('a save taken mid cascade step restores and finishes cleanly', () => {
  G.fresh(); cascadeBoard(); T.drop(2); T.focusId = 0;
  G.until(() => T.state === 'linking');
  T.saveRun(); const sv = T.hasSave();
  assert(sv && typeof sv.speedIdle !== 'undefined', 'a good save that records the player\'s own time');
  T.restoreRun(sv);
  assert(G.idle() && !T.gameOver && T.linkGroups === null);
});
