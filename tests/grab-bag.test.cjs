// b38's next pieces come from a shuffled bag per mode. The counts were chosen with bot
// games so scores stay level with b37's random dealing. The rising floor row stays random,
// the safety net near the top still steps in first, and a saved run keeps its bag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./game-harness.cjs');
const G = loadGame({ seed: 99 });
const { T } = G;

test('every bag deals exactly its counts, bag after bag, in every mode', () => {
  const expected = { zen: [2, 2, 4, 4], time: [11, 10, 10, 9], hard: [2, 2, 2, 2, 2], power: [2, 2, 2, 2, 2] };
  for (const m of Object.keys(expected)) {
    T.setMode(m); T.dealBag = [];
    const counts = T.BAG_COUNTS[m], n = counts.reduce((a, b) => a + b, 0);
    assert.deepEqual(counts, expected[m]);
    assert.equal(counts.length, T.M.pool, m + ' has one count per tile in its pool');
    for (let blk = 0; blk < 5; blk++) {
      const c = new Array(counts.length).fill(0);
      for (let i = 0; i < n; i++) { const x = T.dealFromBag(); assert(x >= 0 && x < counts.length); c[x]++; }
      assert.deepEqual(c, counts, m + ' bag ' + (blk + 1));
    }
  }
});

test('a saved run keeps what is left in its bag', () => {
  T.setMode('zen'); T.startRun(); T.closeSheet(); G.idle();
  T.dealFromBag(); T.dealFromBag();
  T.saveRun(); const s = T.hasSave();
  assert(s && Array.isArray(s.deal) && s.deal.length > 0);
  assert.deepEqual(s.deal, T.dealBag);
  const left = s.deal.slice();
  T.dealBag = []; T.restoreRun(s);
  assert.deepEqual(T.dealBag, left, 'continuing carries on with the same bag');
  assert.deepEqual([T.dealFromBag(), T.dealFromBag()], [left[left.length - 1], left[left.length - 2]]);
  const old = Object.assign({}, s); delete old.deal; localStorage.setItem(T.SAVE, JSON.stringify(old));
  const so = T.hasSave(); T.restoreRun(so);
  assert(so && T.dealBag.length === 0 && T.dealFromBag() >= 0, 'a save from before the bag loads with a fresh bag');
  localStorage.setItem(T.SAVE, JSON.stringify(Object.assign({}, s, { deal: ['x'] })));
  assert.equal(T.hasSave(), null, 'a damaged bag is refused');
  localStorage.setItem(T.SAVE, JSON.stringify(Object.assign({}, s, { deal: new Array(65).fill(0) })));
  assert.equal(T.hasSave(), null, 'an oversized bag is refused');
});

test('the rising floor row and the safety net are unchanged', () => {
  assert.match(G.html, /makeCell\(pickWeighted\(\)\)/);
  assert.match(G.html, /function rollTier\(\)\{[\s\S]{0,400}mergeReady\(true\)[\s\S]{0,300}return dealFromBag\(\);/);
});
