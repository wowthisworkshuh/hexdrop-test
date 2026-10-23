const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('var boardTileCache=');
const end = html.indexOf('function drawTile(', start);
assert(start >= 0 && end > start, 'actual board tile cache implementation must exist');
const source = html.slice(start, end);

function fixture(options = {}) {
  const canvases = [], paints = [], images = [];
  const main = { drawImage: (...args) => images.push(args) };
  const c = {
    Object, Math, R: 30, ctx: main, styleKey: 'signal', tileStyle: 'classic',
    tileShape: 'hex', showNums: true, showDots: true,
    window: { devicePixelRatio: options.dpr || 1 },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const painter = { transforms: [], setTransform(...args) { this.transforms.push(args); } };
      const canvas = { width: 0, height: 0, painter,
        getContext(type) { assert.equal(type, '2d'); return options.noContext ? null : painter; } };
      canvases.push(canvas);
      return canvas;
    } },
    drawTile(...args) {
      paints.push({ ctx: c.ctx, args });
      if (c.failPaint) throw new Error('paint failed');
    }
  };
  vm.createContext(c);
  vm.runInContext(source, c);
  return { c, main, canvases, paints, images,
    draw(tier = 1, focused = false) { c.drawBoardTile(100, 120, tier, c.R * .9, focused, null); } };
}

test('moving an unchanged ordinary tile reuses one raster instead of repainting', () => {
  const f = fixture(); f.draw();
  f.c.drawBoardTile(180, 190, 1, f.c.R * .9, false, null);
  assert.equal(f.paints.length, 1);
  assert.equal(f.canvases.length, 1);
  assert.equal(f.images.length, 2);
  assert.equal(f.images[0][0], f.images[1][0]);
  assert.equal(f.images[1][1] - f.images[0][1], 80);
  assert.equal(f.images[1][2] - f.images[0][2], 70);
});

test('tier and focused appearance receive independent cached images', () => {
  const f = fixture(); f.draw(1, false); f.draw(2, false); f.draw(1, true);
  assert.equal(f.canvases.length, 3);
  f.draw(1, false); f.draw(1, true);
  assert.equal(f.paints.length, 3);
  assert.equal(f.images[0][0], f.images[3][0]);
  assert.equal(f.images[2][0], f.images[4][0]);
});

for (const [property, value] of [
  ['styleKey', 'sunset'], ['tileStyle', 'glass'], ['tileShape', 'circle'],
  ['showNums', false], ['showDots', false], ['R', 32]
]) {
  test(`${property} changes invalidate and release the previous appearance`, () => {
    const f = fixture(); f.draw();
    const previous = f.canvases[0];
    f.c[property] = value; f.draw();
    assert.equal(f.paints.length, 2);
    assert.equal(previous.width, 0);
    assert.equal(previous.height, 0);
    assert.notEqual(f.images[0][0], f.images[1][0]);
    assert.equal(f.c.boardTileCount, 1);
  });
}

test('animated scale and charged tiles keep the live painter and allocate no raster', () => {
  const f = fixture();
  f.c.drawBoardTile(100, 120, 1, f.c.R * .9 * 1.16, false, null);
  f.c.drawBoardTile(100, 120, 1, f.c.R * .9, true, 'frost');
  assert.equal(f.canvases.length, 0);
  assert.equal(f.images.length, 0);
  assert.equal(f.paints.length, 2);
  assert(f.paints.every(p => p.ctx === f.main));
  assert.equal(f.paints[1].args[5], 'frost');
});

test('retina sprites preserve board DPR cap and composite at exact physical scale', () => {
  const f = fixture({ dpr: 3 }); f.c.R = 31.1; f.draw();
  const rad = f.c.R * .9, origin = rad + 3, sprite = f.canvases[0];
  assert.equal(sprite.width, Math.ceil(origin * 2 * 2.5));
  assert.equal(sprite.height, sprite.width);
  assert.deepEqual(sprite.painter.transforms, [[2.5, 0, 0, 2.5, 0, 0]]);
  assert.equal(f.paints[0].ctx, sprite.painter);
  assert.equal(f.paints[0].args[0], origin);
  assert.equal(f.paints[0].args[1], origin);
  assert.equal(f.images[0][1], 100 - origin);
  assert.equal(f.images[0][2], 120 - origin);
  assert.equal(f.images[0][3] * 2.5, sprite.width);
  assert.equal(f.images[0][4] * 2.5, sprite.height);
  assert.equal(f.c.ctx, f.main);
});

test('changing effective DPR releases old raster and creates a sharp replacement', () => {
  const f = fixture({ dpr: 1 }); f.draw();
  const previous = f.canvases[0];
  f.c.window.devicePixelRatio = 2; f.draw();
  assert.equal(previous.width, 0);
  assert.equal(previous.height, 0);
  assert.deepEqual(f.canvases[1].painter.transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.equal(f.c.boardTileCount, 1);
});

test('failed sprite painting restores the shared main context and does not cache failure', () => {
  const f = fixture(); f.c.failPaint = true;
  assert.throws(() => f.draw(), /paint failed/);
  assert.equal(f.c.ctx, f.main);
  assert.equal(f.c.boardTileCount, 0);
  assert.equal(f.images.length, 0);
  f.c.failPaint = false; f.draw();
  assert.equal(f.images.length, 1);
  assert.equal(f.c.ctx, f.main);
});

test('unavailable offscreen context falls back to the live main-context painter', () => {
  const f = fixture({ noContext: true }); f.draw();
  assert.equal(f.paints.length, 1);
  assert.equal(f.paints[0].ctx, f.main);
  assert.deepEqual(f.paints[0].args, [100, 120, 1, f.c.R * .9, false, null]);
  assert.equal(f.images.length, 0);
  assert.equal(f.c.boardTileCount, 0);
});

test('cache remains bounded and discarded surfaces release backing-store dimensions', () => {
  const f = fixture();
  for (let tier = 0; tier < 33; tier++) {
    f.draw(tier);
    assert(f.c.boardTileCount <= 32);
  }
  assert.equal(f.c.boardTileCount, 1);
  assert.equal(Object.keys(f.c.boardTileCache).length, 1);
  assert(f.canvases.slice(0, 32).every(c => c.width === 0 && c.height === 0));
});

test('explicit cache reset releases every raster and permits clean rebuilding', () => {
  const f = fixture(); f.draw(1); f.draw(2); f.c.clearBoardTileCache();
  assert.equal(f.c.boardTileCount, 0);
  assert.equal(Object.keys(f.c.boardTileCache).length, 0);
  assert(f.canvases.every(c => c.width === 0 && c.height === 0));
  f.draw(1);
  assert.equal(f.paints.length, 3);
  assert.equal(f.c.boardTileCount, 1);
});
