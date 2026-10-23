const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
function section(first, next) {
  const start = html.indexOf(first), end = html.indexOf(next, start);
  assert(start >= 0 && end > start, `actual source section exists: ${first}`);
  return html.slice(start, end);
}
const config = section('var BUILD = ', 'var SPEED_WINDOW');
const helpers = section('var patchNotesPending=', '/* Updates.');
const buildNumber = section('function buildNumber(', 'function checkForUpdate(');
const escape = section('function fbEsc(', 'function feedbackBody(');
const storage = section('function LS(', 'function DEL(');
const closeSheet = section('function closeSheet(){', 'function badgesBody(');

function fixture(initial = {}, options = {}) {
  const db = new Map(Object.entries(initial)), listeners = {}, timers = [], opened = [];
  const state = { sheet: null, veil: null, fullad: null };
  const failures = { read: false, write: !!options.failWrites };
  let updates = 0;
  const c = {
    screen: 'menu', gameOver: false, sheetSince: -1, awaySince: -1,
    WEB: options.web ? {} : null, window: {}, updateInfo: null,
    localStorage: {
      getItem(key) { if (failures.read) throw Error('storage unavailable'); return db.has(key) ? db.get(key) : null; },
      setItem(key, value) { if (failures.write) throw Error('storage full'); db.set(key, String(value)); }
    },
    document: {
      hidden: false,
      getElementById: id => state[id] || null,
      querySelector: selector => selector === '.fullad' ? state.fullad : null,
      addEventListener(name, callback) { (listeners[name] ||= []).push(callback); }
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    sheetOpen: () => !!state.sheet,
    maybeOfferUpdate: () => updates++,
    demoStop: () => {}, updateZoomBtn: () => {}, resumeClocks: () => {}
  };
  vm.createContext(c);
  vm.runInContext(config + buildNumber + escape + storage + helpers + closeSheet, c);
  if (options.build) c.BUILD = options.build;
  c.openSheet = (kind, opts) => {
    c.closeSheet();
    const sheet = { getAttribute: name => name === 'data-kind' ? kind : null,
      remove() { if (state.sheet === sheet) state.sheet = null; } };
    state.sheet = sheet;
    opened.push({ kind, opts });
  };
  return {
    c, db, state, failures, timers, opened,
    get updates() { return updates; },
    flush() {
      let count = 0;
      while (timers.length) { assert(++count < 30, 'menu scheduling settles'); timers.shift().callback(); }
    },
    visibility() { for (const callback of listeners.visibilitychange || []) callback(); }
  };
}
const returning = (seen = '', options = {}) => fixture({ 'hexdrop.seen': '1', 'hexdrop.patchNotesSeen': seen }, options);
const notesOpened = f => f.opened.filter(sheet => sheet.kind === 'patchnotes').length;

test('a fresh copy acknowledges its bundled build without adding another onboarding sheet', () => {
  const f = fixture();
  f.c.initPatchNotes();
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), f.c.BUILD);
  assert.equal(f.c.patchNotesPending, false);
  f.c.maybeShowMenuNotice();
  assert.equal(notesOpened(f), 0);
  f.c.openSheet('install');
  f.c.openSheet('help');
  f.flush();
  assert.equal(f.state.sheet.getAttribute('data-kind'), 'help');
  assert.equal(notesOpened(f), 0);
});

test('returning players see notes once per session and acknowledgement waits for dismissal', () => {
  const f = returning();
  f.c.initPatchNotes();
  assert.equal(f.c.patchNotesPending, true);
  assert.equal(f.c.maybeOfferPatchNotes(), true);
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), '');
  assert.equal(f.c.patchNotesShown, true);
  for (let repeat = 0; repeat < 4; repeat++) assert.equal(f.c.maybeOfferPatchNotes(), false);
  assert.equal(notesOpened(f), 1);
  f.c.closeSheet();
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), f.c.BUILD);
  assert.equal(f.c.patchNotesPending, false);
  f.flush();
  assert.equal(notesOpened(f), 1);
  const reload = fixture(Object.fromEntries(f.db));
  reload.c.initPatchNotes();
  assert.equal(reload.c.maybeOfferPatchNotes(), false);
});

test('a reload before dismissing keeps the current build unacknowledged', () => {
  const f = returning(); f.c.initPatchNotes(); f.c.maybeOfferPatchNotes();
  const reload = fixture(Object.fromEntries(f.db)); reload.c.initPatchNotes();
  assert.equal(reload.c.maybeOfferPatchNotes(), true);
});

test('same or newer acknowledged builds suppress automatic notes; older builds do not', () => {
  const current = fixture().c.BUILD, number = fixture().c.buildNumber(current);
  for (const [seen, expected] of [[`b${number - 1}`, true], [current, false], [`b${number + 1}`, false], ['invalid', true]]) {
    const f = returning(seen); f.c.initPatchNotes();
    assert.equal(f.c.maybeOfferPatchNotes(), expected, `seen ${seen}, loaded ${current}`);
  }
});

test('a stale cached build never lowers an acknowledgement from a newer copy', () => {
  const f = returning('b99', { build: 'b35' });
  f.c.initPatchNotes();
  assert.equal(f.c.patchNotesPending, false);
  f.c.markPatchNotesSeen();
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), 'b99');
  const fresh = fixture({ 'hexdrop.patchNotesSeen': 'b99' }, { build: 'b35' });
  fresh.c.initPatchNotes();
  assert.equal(fresh.db.get('hexdrop.patchNotesSeen'), 'b99');
});

test('another copy acknowledging this or a newer build cancels notes that were deferred earlier', () => {
  const loaded = fixture().c.BUILD, next = `b${fixture().c.buildNumber(loaded) + 1}`;
  for (const acknowledged of [loaded, next]) {
    const f = returning(); f.c.initPatchNotes();
    f.c.document.hidden = true;
    assert.equal(f.c.maybeOfferPatchNotes(), false);
    assert.equal(f.c.patchNotesPending, true);
    f.db.set('hexdrop.patchNotesSeen', acknowledged);
    f.c.document.hidden = false;
    assert.equal(f.c.maybeOfferPatchNotes(), false);
    assert.equal(f.c.patchNotesPending, false);
    assert.equal(f.c.patchNotesShown, false);
    assert.equal(notesOpened(f), 0);
    assert.equal(f.db.get('hexdrop.patchNotesSeen'), acknowledged);
  }
});

test('gameplay, other sheets, game-over cards, hidden pages and ads defer notes without acknowledging them', () => {
  const blocked = [
    ['gameplay', f => { f.c.screen = 'game'; }],
    ['game-over screen', f => { f.c.screen = 'game'; f.c.gameOver = true; }],
    ['help', f => { f.c.openSheet('help'); }],
    ['install', f => { f.c.openSheet('install'); }],
    ['settings', f => { f.c.openSheet('settings'); }],
    ['game-over card', f => { f.state.veil = {}; }],
    ['hidden page', f => { f.c.document.hidden = true; }],
    ['HTML fullscreen ad', f => { f.state.fullad = {}; }],
    ['native fullscreen ad', f => { f.c.window.__adFinished = () => {}; }]
  ];
  for (const [name, block] of blocked) {
    const f = returning(); f.c.initPatchNotes(); block(f);
    assert.equal(f.c.maybeOfferPatchNotes(), false, name);
    assert.equal(f.c.patchNotesPending, true, name);
    assert.equal(f.c.patchNotesShown, false, name);
    assert.equal(f.db.get('hexdrop.patchNotesSeen'), '', name);
    assert.equal(notesOpened(f), 0, name);
    f.c.screen = 'menu'; f.c.document.hidden = false;
    f.state.sheet = f.state.veil = f.state.fullad = null; f.c.window.__adFinished = null;
    assert.equal(f.c.maybeOfferPatchNotes(), true, `after ${name}`);
  }
});

test('a queued close callback rechecks the screen after Start playing or Continue', () => {
  const f = returning(); f.c.initPatchNotes();
  f.c.openSheet('help'); f.c.closeSheet();
  assert.equal(f.timers.length, 1);
  f.c.screen = 'game'; f.flush();
  assert.equal(notesOpened(f), 0);
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), '');
  f.c.screen = 'menu'; f.c.maybeShowMenuNotice();
  assert.equal(notesOpened(f), 1);
});

test('install-to-help sheet replacement cannot be interrupted by a queued menu notice', () => {
  const f = returning(); f.c.initPatchNotes();
  f.c.openSheet('install'); f.c.openSheet('help'); f.flush();
  assert.equal(notesOpened(f), 0);
  assert.equal(f.state.sheet.getAttribute('data-kind'), 'help');
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), '');
  f.c.closeSheet(); f.flush();
  assert.equal(notesOpened(f), 1);
});

test('foreground scheduling also rechecks eligibility when its deferred callback runs', () => {
  const f = returning(); f.c.initPatchNotes();
  f.c.document.hidden = true; f.visibility();
  assert.equal(f.timers.length, 0);
  f.c.document.hidden = false; f.visibility();
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 250);
  f.c.screen = 'game'; f.flush();
  assert.equal(notesOpened(f), 0);
  f.c.screen = 'menu'; f.visibility(); f.flush();
  assert.equal(notesOpened(f), 1);
});

test('manual notes dismissal acknowledges the current build even when automatic display was pending', () => {
  const f = returning(); f.c.initPatchNotes();
  f.c.openSheet('settings'); f.c.openSheet('patchnotes', { from: 'settings' });
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), '');
  f.c.closeSheet();
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), f.c.BUILD);
  f.flush(); assert.equal(notesOpened(f), 1);
  f.c.openSheet('patchnotes', { from: 'settings' }); f.c.closeSheet(); f.flush();
  assert.equal(notesOpened(f), 2, 'explicit reopening remains available after acknowledgement');
});

test('storage write failure retains the in-memory guard instead of repeatedly opening notes', () => {
  const f = returning('', { failWrites: true }); f.c.initPatchNotes();
  assert.equal(f.c.maybeOfferPatchNotes(), true);
  assert.doesNotThrow(() => f.c.closeSheet());
  f.flush();
  assert.equal(f.db.get('hexdrop.patchNotesSeen'), '');
  assert.equal(f.c.patchNotesShown, true);
  assert.equal(f.c.patchNotesPending, false);
  assert.equal(notesOpened(f), 1);
  f.failures.read = true;
  assert.doesNotThrow(() => f.c.markPatchNotesSeen());
});

test('notes render escaped bundled content independently of downloaded update metadata', () => {
  const f = returning();
  assert(f.c.PATCH_NOTES.length > 0);
  f.c.PATCH_NOTES.push('<script>alert("bad")</script> & <img src=x>');
  f.c.updateInfo = { build: 'b999', notes: 'REMOTE TEXT MUST NOT REPLACE BUNDLED NOTES' };
  const rendered = f.c.patchNotesBody();
  for (const note of f.c.PATCH_NOTES) assert(rendered.includes('<li>' + f.c.fbEsc(note) + '</li>'));
  assert.equal((rendered.match(/<li>/g) || []).length, f.c.PATCH_NOTES.length);
  assert(!rendered.includes('<script>')); assert(!rendered.includes('<img'));
  assert(rendered.includes('&lt;script&gt;alert(&quot;bad&quot;)&lt;/script&gt; &amp; &lt;img src=x&gt;'));
  assert(!rendered.includes('REMOTE TEXT MUST NOT REPLACE BUNDLED NOTES'));
  assert.match(rendered, /Settings.*Options.*Patch notes/);
});

test('bundled notes take priority over a remote update and hidden or ad-covered pages open neither', () => {
  const f = returning('', { web: true }); f.c.initPatchNotes();
  f.c.maybeShowMenuNotice();
  assert.equal(notesOpened(f), 1); assert.equal(f.updates, 0);
  f.c.closeSheet(); f.flush();
  assert.equal(f.updates, 1);
  for (const block of [g => { g.c.document.hidden = true; }, g => { g.state.fullad = {}; }, g => { g.c.window.__adFinished = () => {}; }]) {
    const g = returning('', { web: true }); g.c.initPatchNotes(); block(g);
    g.c.maybeShowMenuNotice();
    assert.equal(notesOpened(g), 0); assert.equal(g.updates, 0);
  }
});
