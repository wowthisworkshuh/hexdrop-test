// b38's shapes: Rounded is the default and free, Pebble, Mosaic and Blossom are on the score
// track, and Circle, Square, Diamond and Octagon are retired but kept by whoever had them
// when b38 first ran. Every shape stays clear of its neighbours.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./game-harness.cjs');
const G = loadGame();
const { T } = G;

test('a new player starts on Rounded, with no retired shapes written down', () => {
  assert.equal(T.tileShape, 'round');
  assert.equal(localStorage.getItem('hexdrop.legacyShapes'), '[]');
  assert.equal(T.lockText('shape', 'round'), null);
  assert.equal(T.lockText('shape', 'hex'), null);
  for (const k of ['circle', 'square', 'diamond', 'octagon']) assert.equal(T.lockText('shape', k), 'Retired');
  const pane = T.settingsPane('shape');
  for (const k of ['round', 'hex', 'pebble', 'mosaic', 'blossom']) assert.match(pane, new RegExp('data-shape="' + k + '"'));
  for (const k of ['circle', 'square', 'diamond', 'octagon']) assert.doesNotMatch(pane, new RegExp('data-shape="' + k + '"'));
});

test('the score track', () => {
  assert.deepEqual(T.TRACK.map(s => [s.shape || s.style || s.palette, s.score]),
    [['pebble', 250000], ['outline', 750000], ['mosaic', 1500000], ['sunset', 3000000], ['blossom', 5000000], ['glass', 12000000]]);
  T.stats.lifetime = 0;
  assert.equal(T.lockText('shape', 'pebble'), 'Reach 250,000 lifetime points');
});

test('a player who had reached retired shapes keeps exactly those', () => {
  T.stats.lifetime = 6000000; localStorage.removeItem('hexdrop.legacyShapes'); T.loadLegacyShapes();
  assert.deepEqual(JSON.parse(localStorage.getItem('hexdrop.legacyShapes')), ['circle', 'square']);
  assert.equal(T.lockText('shape', 'circle'), null);
  assert.equal(T.lockText('shape', 'square'), null);
  assert.equal(T.lockText('shape', 'diamond'), 'Retired');
  const pane = T.settingsPane('shape');
  assert.match(pane, /data-shape="circle"/); assert.match(pane, /data-shape="square"/); assert.doesNotMatch(pane, /data-shape="diamond"/);
  // the list is written once: passing 8M later does not bring Diamond back
  T.stats.lifetime = 8500000; T.loadLegacyShapes();
  assert.equal(T.lockText('shape', 'diamond'), 'Retired');
  // a track step already seen counts too
  T.stats.lifetime = 0; T.trackSeen = { '20000000': 1 }; localStorage.removeItem('hexdrop.legacyShapes'); T.loadLegacyShapes();
  assert.deepEqual(JSON.parse(localStorage.getItem('hexdrop.legacyShapes')), ['octagon']);
});

test('a saved shape that is retired and not yours falls back to Rounded', () => {
  T.trackSeen = {}; T.stats.lifetime = 0; localStorage.setItem('hexdrop.legacyShapes', '[]'); T.loadLegacyShapes();
  T.applyShape('octagon', false);
  assert.equal(T.tileShape, 'round');
  T.applyShape('hex', false);
  assert.equal(T.tileShape, 'hex');
});

test('no shape ever reaches a neighbour: under 0.84 of the grid radius toward each of the six', () => {
  const R = 30, rad = R * 0.9;
  for (const k of Object.keys(T.SHAPES)) {
    for (const a of [30, 90, 150, 210, 270, 330]) {
      const reach = T.shapeSupport(k, rad, a * Math.PI / 180) / R;
      assert(reach < 0.84, k + ' reaches ' + reach.toFixed(3) + ' toward ' + a + '°');
    }
  }
  for (const k of ['pebble', 'mosaic', 'blossom']) {
    const d = T.shapeSVGPath(k, 17);
    assert.doesNotMatch(d, /NaN|undefined/); assert(d.length > 200, k + ' has an outline for the menu and the rail');
  }
});
