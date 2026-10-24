// Runs the whole game in Node with a small stand-in for the browser, for tests that
// need real frames: falls, cascade steps, clocks, saves. Time only moves when a test
// calls tick(), so every check is exact and repeatable. Nothing can reach the network:
// the web layer (service address, update checks) is left out, and fetch, XHR and
// beacons all refuse. Not a test file itself (the CI runs tests/*.test.cjs).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function El(tag, id) {
  const ls = {};
  return {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', _hidden: false, children: [], style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); } },
    set hidden(v) { this._hidden = v; }, get hidden() { return this._hidden; },
    _html: '', textContent: '', disabled: false, clientWidth: 400, clientHeight: 600, offsetHeight: 20,
    set innerHTML(v) {
      this._html = v;
      const re = /id="([^"]+)"/g; let m;
      while ((m = re.exec(String(v)))) if (!REG.has(m[1])) REG.set(m[1], El('div', m[1]));
    },
    get innerHTML() { return this._html; },
    width: 0, height: 0,
    appendChild(c) { this.children.push(c); if (c && c.id && !REG.has(c.id)) REG.set(c.id, c); return c; },
    remove() { REG.delete(this.id); },
    addEventListener(ev, fn) { (ls[ev] = ls[ev] || []).push(fn); },
    removeEventListener() {},
    dispatch(ev, e) { (ls[ev] || []).forEach(fn => fn(e)); return e; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    querySelector() { const x = El('div'); x.onclick = null; return x; }, querySelectorAll() { return []; },
    animate() { return {}; }, focus() {}, blur() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 }; },
    getContext() { return CTX; },
    closest() { return null; },
    insertBefore() {}
  };
}
const CTX = new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : (k === 'createLinearGradient' || k === 'createRadialGradient')
  ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}) });
const REG = new Map();
const IDS = ['cv', 'board', 'menu', 'modes', 'mHelp', 'mSet', 'mBoard', 'hud', 'rail', 'status', 'stFloor', 'stRank', 'stMeter', 'adband',
  'backBtn', 'modePill', 'helpBtn', 'setBtn', 'best', 'score', 'chipNow', 'chipN1', 'chipN2',
  'chipHold', 'holdBtn', 'soundBtn', 'combo', 'comboHead', 'comboRail', 'bannerSlot', 'wrap'];

function loadGame({ seed = 4711, store = {} } = {}) {
  REG.clear(); IDS.forEach(i => REG.set(i, El('div', i)));
  const docLs = {}, winLs = {};
  global.document = {
    documentElement: { style: { setProperty() {} } }, body: El('body'), hidden: false,
    getElementById(id) { return REG.has(id) ? REG.get(id) : null; },
    createElement(t) { return El(t); },
    addEventListener(ev, fn) { (docLs[ev] = docLs[ev] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    fonts: { load() { return Promise.resolve([]); }, check() { return true; }, ready: Promise.resolve() }
  };
  global.window = global;
  global.addEventListener = (ev, fn) => { (winLs[ev] = winLs[ev] || []).push(fn); };
  global.removeEventListener = () => {};
  global.getComputedStyle = () => ({ getPropertyValue: () => '#888' });
  global.requestAnimationFrame = () => 1;
  global.__clock = 0;
  global.performance = { now: () => global.__clock };
  const mem = new Map(Object.entries(store));
  global.localStorage = { getItem(k) { return mem.has(k) ? mem.get(k) : null; }, setItem(k, v) { mem.set(k, String(v)); },
    removeItem(k) { mem.delete(k); }, get length() { return mem.size; }, key(i) { return Array.from(mem.keys())[i] || null; } };
  global.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  global.AudioContext = undefined;
  global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  global.innerWidth = 400; global.innerHeight = 800;
  // the game's own timers (toasts, the rank check, banners) must not keep a finished test alive
  const realSetTimeout = setTimeout, realSetInterval = setInterval;
  global.setTimeout = (fn, ms, ...a) => { const h = realSetTimeout(fn, ms, ...a); if (h && h.unref) h.unref(); return h; };
  global.setInterval = (fn, ms, ...a) => { const h = realSetInterval(fn, ms, ...a); if (h && h.unref) h.unref(); return h; };
  global.fetch = () => Promise.reject(new Error('network is disabled in tests'));
  global.XMLHttpRequest = function () { throw new Error('network is disabled in tests'); };
  try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', onLine: true, language: 'en', sendBeacon() { return false; } }, configurable: true, writable: true }); } catch (e) {}
  // the deal and the bot are repeatable
  let rs = seed; Math.random = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
  html = html.replace(/<script>window\.HEXDROP_WEB=.*?<\/script>\n?/, '');
  const open = html.indexOf('<script>'), close = html.lastIndexOf('</scr' + 'ipt>');
  let js = html.slice(open + 8, close);
  if (js.includes('<scr' + 'ipt')) throw new Error('expected the game in one script block');
  const at = js.lastIndexOf('})();');
  js = js.slice(0, at) + HOOKS + js.slice(at);
  // eslint-disable-next-line no-eval
  (0, eval)(js);
  const T = global.__T;
  ['zen', 'hard', 'time', 'power'].forEach(m => localStorage.setItem('hexdrop.seen.' + m, '1'));
  localStorage.setItem('hexdrop.seen', '1');
  T.closeSheet();
  let t = 1000;
  const G = {
    T, html, REG, El, docListeners: docLs,
    get now() { return t; },
    tick(ms) { t += ms; global.__clock = t; T.frame(t); },
    until(fn, max = 3000) { for (let i = 0; i < max; i++) { if (fn()) return true; G.tick(17); } return false; },
    idle() { return G.until(() => T.state === 'idle'); },
    wait(ms) { const end = t + ms; while (t < end) G.tick(16); },
    board(spec) {
      const cols = spec.map(col => col.map(tr => T.makeCell(tr)));
      cols.forEach((a, c) => a.forEach((cell, r) => { cell.vy = T.cy(c, r); }));
      T.cols = cols; T.nextRiseAt = 9999;
    },
    fresh(m = 'zen') { T.setMode(m); T.startRun(); T.closeSheet(); G.idle(); },
    fireDoc(ev, e) { (docLs[ev] || []).forEach(fn => fn(e)); return e; }
  };
  return G;
}

// Read and write access to the game's own variables, for the tests only.
const HOOKS = 'window.__T={' + [
  'setMode:setMode', 'startRun:startRun', 'closeSheet:closeSheet', 'frame:frame', 'drop:drop', 'makeCell:makeCell', 'cy:cy',
  'saveRun:saveRun', 'hasSave:hasSave', 'restoreRun:restoreRun', 'SAVE:SAVE', 'termByKey:termByKey', 'riseLine:riseLine',
  'dealFromBag:dealFromBag', 'BAG_COUNTS:BAG_COUNTS', 'PACE:PACE', 'DOUBLE_TAP_MS:DOUBLE_TAP_MS',
  'lockText:lockText', 'shapeSupport:shapeSupport', 'shapeOutline:shapeOutline', 'shapeSVGPath:shapeSVGPath', 'loadLegacyShapes:loadLegacyShapes',
  'applyShape:applyShape', 'SHAPES:SHAPES', 'TRACK:TRACK', 'LEGACY_SHAPES:LEGACY_SHAPES', 'settingsPane:settingsPane',
  'lbCompactQueue:lbCompactQueue', 'lbDayKey:lbDayKey', 'lbMonthKey:lbMonthKey', 'queueFeedback:queueFeedback', 'fbQueue:fbQueue',
  'lbReadable:lbReadable', 'NAME_COLORS:NAME_COLORS', 'frameW:frameW', 'drawTile:drawTile',
  'get cols(){return cols}', 'set cols(v){cols=v}', 'get state(){return state}', 'set state(v){state=v}',
  'get score(){return score}', 'get drops(){return drops}', 'get combo(){return combo}', 'get gameOver(){return gameOver}',
  'get speedIdle(){return speedIdle}', 'get speedStreak(){return speedStreak}', 'get lastMergeAt(){return lastMergeAt}',
  'get SPEED_WINDOW(){return SPEED_WINDOW}', 'get FLOOR_MOVING_RATE(){return FLOOR_MOVING_RATE}', 'get riseAtMs(){return riseAtMs}',
  'get linkGroups(){return linkGroups}', 'get linkAge(){return linkAge}', 'get M(){return M}',
  'get dealBag(){return dealBag}', 'set dealBag(v){dealBag=v}', 'get bag(){return bag}', 'set bag(v){bag=v}',
  'set focusId(v){focusId=v}', 'set nextRiseAt(v){nextRiseAt=v}',
  'get tileShape(){return tileShape}', 'get legacyOwned(){return legacyOwned}', 'get stats(){return stats}',
  'get trackSeen(){return trackSeen}', 'set trackSeen(v){trackSeen=v}', 'get lbShownN(){return lbShownN}',
  'get lbShownSize(){return Object.keys(lbShown).length}'
].join(',') + '};';

module.exports = { loadGame };
