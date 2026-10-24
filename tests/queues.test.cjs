// b38: offline play can no longer lose a best score from a full upload queue, a full
// feedback queue never silently drops a saved message, and the leaderboard's colour
// memo stays bounded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./game-harness.cjs');
const G = loadGame();
const { T } = G;
const DAY = 86400000, START = Date.UTC(2026, 9, 1, 19);   // noon Pacific, 1 Oct

test('a short queue is left exactly as it is', () => {
  const q = [{ mode: 'zen', score: 5, at: START }, { mode: 'zen', score: 9, at: START + DAY }];
  assert.deepEqual(T.lbCompactQueue(q), q);
});

test('an overflowing queue keeps every best for the day, month and all time boards', () => {
  const q = [];
  // 70 games over 70 days in Zen, each day's single score, rising and falling
  for (let i = 0; i < 70; i++) q.push({ mode: 'zen', score: 1000 + ((i * 37) % 50) * 10, at: START + i * DAY, qid: 'z' + i });
  const out = T.lbCompactQueue(q.slice());
  assert(out.length <= 60, 'at most 60 kept, got ' + out.length);
  const best = Math.max(...q.map(e => e.score));
  assert(out.some(e => e.score === best), 'the all-time best is kept');
  const months = {};
  q.forEach(e => { const k = T.lbMonthKey(e.at); months[k] = Math.max(months[k] || 0, e.score); });
  for (const k of Object.keys(months)) assert(out.some(e => T.lbMonthKey(e.at) === k && e.score === months[k]), 'the best of ' + k + ' is kept');
  // day-only bests go oldest first
  const keptDays = out.map(e => e.at).sort((a, b) => a - b);
  assert(keptDays[keptDays.length - 1] === q[69].at, 'the newest day is kept');
});

test('a score beaten on the same day by a higher one in the same mode is what goes first', () => {
  const q = [];
  for (let i = 0; i < 61; i++) q.push({ mode: 'hard', score: 100 + i, at: START + 1000 * i, qid: 'h' + i });   // one day, rising
  const out = T.lbCompactQueue(q.slice());
  assert.equal(out.length, 1); assert.equal(out[0].score, 160);
});

test('a full feedback queue refuses the new message and keeps every saved one', () => {
  localStorage.removeItem('hexdrop.fbq');
  const before = T.fbQueue().length;
  let n = before, accepted = 0;
  while (n < 20) { assert.equal(T.queueFeedback({ id: 'm' + n, text: 'note ' + n }), true); n++; accepted++; }
  const saved = JSON.stringify(T.fbQueue());
  assert.equal(T.fbQueue().length, 20);
  assert.equal(T.queueFeedback({ id: 'extra', text: 'one too many' }), false);
  assert.equal(JSON.stringify(T.fbQueue()), saved, 'nothing older was dropped');
  assert.equal(T.queueFeedback({ id: 'm0', text: 'resent' }), true, 'resending a queued message replaces it in place');
});

test('the leaderboard colour memo stays bounded', () => {
  for (let i = 0; i < 400; i++) T.lbReadable('#' + (0x100000 + i * 997).toString(16).slice(-6).toUpperCase());
  assert(T.lbShownN <= 256 && T.lbShownSize <= 256, T.lbShownSize + ' colours kept');
});
