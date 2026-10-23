const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.HEXDROP_HTML || path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('var SPARK_CAP=');
const end = html.indexOf('function addFx(', start);
assert(start >= 0 && end > start, 'actual spark burst implementation must exist');
const source = html.slice(start, end);

// Previous behavior is the oracle for visible particles and the shared RNG.
const original = `var SPARK_CAP=260;
function burst(x,y,col,n,speed,up){
  for(var i=0;i<n;i++){
    if(sparks.length>=SPARK_CAP) sparks.shift();
    var a=Math.random()*Math.PI*2, v=speed*(0.45+Math.random()*0.8);
    sparks.push({x:x,y:y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-(up||0),col:col,
                 t:0,life:0.55+Math.random()*0.5,sz:1.6+Math.random()*2.2});
  }
}`;

function fixture(code, initial = 0) {
  let seed = 0x1234abcd;
  const work = { random: 0, trig: 0, created: 0, evictions: 0 };
  const math = Object.create(Math);
  math.random = () => {
    work.random++;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (const name of ['sin', 'cos']) {
    math[name] = value => { work.trig++; return Math[name](value); };
  }
  const sparks = Array.from({ length: initial }, (_, id) => ({ id, t: 0.1 }));
  const old = sparks.slice();
  Object.defineProperties(sparks, {
    push: { value(...items) { work.created += items.length; return Array.prototype.push.apply(this, items); } },
    shift: { value() { work.evictions++; return Array.prototype.shift.call(this); } },
    splice: { value(...args) { work.evictions++; return Array.prototype.splice.apply(this, args); } }
  });
  const context = { Math: math, sparks };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, sparks, old, work, next: math.random };
}

function sameParticles(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
}

test('bursts preserve every visible particle and the next shared random value at all cap boundaries', () => {
  for (const initial of [0, 1, 127, 259, 260]) {
    for (const count of [0, 0.1, 1, 5, 14, 259, 260, 261, 700]) {
      const actual = fixture(source, initial), expected = fixture(original, initial);
      actual.context.burst(20, 30, '#f80', count, 150, 90);
      expected.context.burst(20, 30, '#f80', count, 150, 90);
      sameParticles(actual.sparks, expected.sparks);
      assert.equal(actual.sparks.length, Math.min(260, initial + Math.ceil(count)));
      assert.equal(actual.work.random, expected.work.random);
      assert.equal(actual.next(), expected.next(), `RNG after ${initial} old sparks + ${count} new sparks`);
      assert(actual.work.evictions <= 1, 'eviction work must be batched per burst');
      for (const particle of actual.sparks) {
        if ('id' in particle) assert.equal(particle, actual.old[particle.id], 'old survivors retain their identity');
      }
    }
  }
});

test('oversized bursts only construct and calculate trajectories for the 260 surviving sparks', () => {
  const actual = fixture(source, 260), expected = fixture(original, 260);
  actual.context.burst(10, 15, '#abc', 700, 100, 0);
  expected.context.burst(10, 15, '#abc', 700, 100, 0);
  sameParticles(actual.sparks, expected.sparks);
  assert.equal(actual.work.created, 260);
  assert.equal(actual.work.trig, 520);
  assert.equal(actual.work.random, 2800);
  assert.equal(expected.work.created, 700);
  assert.equal(expected.work.trig, 1400);
  assert.equal(actual.next(), expected.next());
});

test('repeated bursts preserve the full visible sequence and random stream through multiple evictions', () => {
  const actual = fixture(source, 259), expected = fixture(original, 259);
  for (const [index, count] of [4, 14, 0, 300, 2, 260, 1].entries()) {
    const args = [index * 10, 50, '#09f', count, 160 + index, index % 2 ? undefined : 80];
    actual.context.burst(...args);
    expected.context.burst(...args);
    sameParticles(actual.sparks, expected.sparks);
    assert.equal(actual.work.random, expected.work.random);
    assert.equal(actual.next(), expected.next());
  }
});

test('empty or nonpositive bursts leave existing particles and RNG untouched', () => {
  const actual = fixture(source, 260);
  for (const count of [0, -1, -0.1, NaN, undefined]) {
    actual.context.burst(0, 0, '#fff', count, 100);
    assert.deepEqual(actual.sparks, actual.old);
    assert.deepEqual(actual.work, { random: 0, trig: 0, created: 0, evictions: 0 });
  }
});
