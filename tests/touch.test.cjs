// b38: quick taps on iPhone must not zoom the page. b34's touch-action rule was not enough
// on iOS, so the game cancels the touch itself: the board's own touches always, a quick
// second tap anywhere else (handed on as a click so no button misses a tap). Typing and
// drags are left alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./game-harness.cjs');
const G = loadGame();
const cv = G.REG.get('cv'), board = G.REG.get('board');
let clock = 1e6; const realNow = Date.now;
test.before(() => { Date.now = () => clock; });
test.after(() => { Date.now = realNow; });

function el({ input = false, disabled = false } = {}) {
  const e = G.El('button'); e.clicks = 0;
  e.click = () => { e.clicks++; };
  e.closest = sel => {
    if (/input|textarea/.test(sel)) return input ? e : null;
    if (/button:disabled/.test(sel)) return disabled ? e : null;
    return null;
  };
  return e;
}
function touch(type, target, x, y, rest = 0) {
  const p = { clientX: x, clientY: y };
  return { type, target, cancelable: true, prevented: false, preventDefault() { this.prevented = true; },
    touches: type === 'touchend' ? new Array(rest).fill(p) : [p], changedTouches: [p] };
}
function tap(target, x = 100, y = 100, gapMs = 0) {
  clock += gapMs;
  G.fireDoc('touchstart', touch('touchstart', target, x, y));
  clock += 60;
  return G.fireDoc('touchend', touch('touchend', target, x, y));
}

test('touches on the board itself are claimed; the game-over card inside it is not', () => {
  assert.equal(board.dispatch('touchstart', touch('touchstart', cv, 5, 5)).prevented, true);
  assert.equal(board.dispatch('touchstart', touch('touchstart', board, 5, 5)).prevented, true);
  assert.equal(board.dispatch('touchstart', touch('touchstart', el(), 5, 5)).prevented, false);
});

test('a single tap is left alone; a quick second tap is cancelled and still clicks once', () => {
  const b = el();
  assert.equal(tap(b, 100, 100, 5000).prevented, false);
  const second = tap(b, 100, 100, 150);
  assert.equal(second.prevented, true, 'no double-tap zoom');
  assert.equal(b.clicks, 1, 'the second tap still lands, once');
  assert.equal(tap(b, 100, 100, 2000).prevented, false, 'a tap well after is ordinary again');
});

test('typing, disabled buttons and drags behave as before', () => {
  const field = el({ input: true });
  tap(field, 50, 50, 5000);
  assert.equal(tap(field, 50, 50, 100).prevented, false, 'quick taps in a text field are never cancelled');
  const off = el({ disabled: true });
  tap(off, 50, 50, 5000);
  assert.equal(tap(off, 50, 50, 100).prevented, true);
  assert.equal(off.clicks, 0, 'a disabled button is not clicked');
  const b = el();
  tap(b, 50, 50, 5000);
  clock += 100; G.fireDoc('touchstart', touch('touchstart', b, 50, 50)); clock += 60;
  const drag = G.fireDoc('touchend', touch('touchend', b, 50, 120));
  assert.equal(drag.prevented, false, 'a drag is not a tap');
  assert.equal(b.clicks, 0);
});

test('a two-finger touch is not treated as a tap', () => {
  const b = el();
  tap(b, 50, 50, 5000);
  clock += 100; G.fireDoc('touchstart', touch('touchstart', b, 50, 50)); clock += 60;
  assert.equal(G.fireDoc('touchend', touch('touchend', b, 50, 50, 1)).prevented, false);
});
