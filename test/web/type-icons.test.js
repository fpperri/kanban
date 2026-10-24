const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  TYPE_ICON_NAMES, typeIconGlyph, typeIconOutline, typeIconReach, typeIconOf,
} = require('../web/type-icons');
const { ICON_NAMES } = require('../scripts/config-store');
const { topLevelDeclarations, collisions } = require('./helpers/global-scope');

const NAMES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star'];
const GLYPHS = { circle: '\u25cf', square: '\u25a0', diamond: '\u25c6', triangle: '\u25b2', hexagon: '\u2b22', star: '\u2605' };

// The corner points of an outline, read back from its path text.
const corners = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const farthest = (d) => Math.max(...corners(d).map((p) => Math.hypot(p.x, p.y)));

test('the closed table holds the six names the board config may give a type, in order', () => {
  assert.deepStrictEqual([...TYPE_ICON_NAMES], NAMES);
  assert.deepStrictEqual([...TYPE_ICON_NAMES], [...ICON_NAMES], 'the page and the config reader name the same six');
  assert.ok(Object.isFrozen(TYPE_ICON_NAMES));
});

test('each of the six names gives its glyph', () => {
  for (const name of NAMES) assert.strictEqual(typeIconGlyph(name), GLYPHS[name], name);
});

test('each of the six names gives a closed outline for a dot radius', () => {
  for (const name of NAMES) {
    const d = typeIconOutline(name, 10);
    assert.match(d, /^M.*Z$/, name);
    assert.strictEqual((d.match(/M/g) || []).length, 1, `${name}: one subpath`);
    assert.doesNotMatch(d, /NaN|Infinity|undefined/, name);
  }
});

test('the polygons have their corners: a square and a diamond four, a triangle three, a hexagon six, a star ten', () => {
  const count = { square: 4, diamond: 4, triangle: 3, hexagon: 6, star: 10 };
  for (const [name, n] of Object.entries(count)) assert.strictEqual(corners(typeIconOutline(name, 10)).length, n, name);
});

test('worked outlines at radius 10: a diamond and a square, and a circle drawn as two arcs', () => {
  assert.strictEqual(typeIconOutline('diamond', 10), 'M13 0L0 13L-13 0L0 -13Z');
  assert.strictEqual(typeIconOutline('square', 10), 'M8.49 8.49L-8.49 8.49L-8.49 -8.49L8.49 -8.49Z');
  assert.strictEqual(typeIconOutline('circle', 10), 'M10 0A10 10 0 1 1 -10 0A10 10 0 1 1 10 0Z');
});

test('the triangle points up and the star has a point straight up', () => {
  const tri = corners(typeIconOutline('triangle', 10));
  assert.deepStrictEqual(tri[0], { x: 0, y: -13.5 });
  assert.ok(tri[1].y > 0 && tri[2].y > 0, 'the other two corners sit below the centre');
  const star = corners(typeIconOutline('star', 10));
  assert.deepStrictEqual(star[0], { x: 0, y: -14 });
  assert.ok(Math.abs(star[1].x * star[1].x + star[1].y * star[1].y - 36) < 0.1, 'the first inner corner sits at 0.6 of the radius');
});

test('an outline scales with the dot radius', () => {
  for (const name of NAMES.filter((n) => n !== 'circle')) {
    const small = corners(typeIconOutline(name, 5));
    const big = corners(typeIconOutline(name, 20));
    assert.strictEqual(small.length, big.length, name);
    small.forEach((p, i) => {
      assert.ok(Math.abs(p.x * 4 - big[i].x) < 0.1 && Math.abs(p.y * 4 - big[i].y) < 0.1, `${name} corner ${i}`);
    });
  }
});

test('the reach of a shape is its farthest point from the dot centre, which the outline never passes', () => {
  const reach = { circle: 10, square: 12, diamond: 13, triangle: 13.5, hexagon: 11.5, star: 14 };
  for (const name of NAMES) {
    assert.strictEqual(typeIconReach(name, 10), reach[name], name);
    if (name !== 'circle') assert.ok(Math.abs(farthest(typeIconOutline(name, 10)) - reach[name]) < 0.01, `${name}: the outline's farthest corner`);
  }
});

test('an unknown, blank or hostile name gives no glyph, no outline and no reach', () => {
  const hostile = [
    undefined, null, '', ' ', 'blob', 'Star', 'STAR', ' star', 'star ', 'stars', 0, 42, true, {}, ['star'], { toString: () => 'star' },
    '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
    '<img src=x onerror=alert(1)>', 'star"><script>x</script>', 'star onload=x', 'star\n', "star'", 'url(javascript:x)', 'M0 0L9 9Z',
  ];
  for (const name of hostile) {
    const label = JSON.stringify(name) || String(name);
    assert.strictEqual(typeIconGlyph(name), '', `glyph of ${label}`);
    assert.strictEqual(typeIconOutline(name, 10), '', `outline of ${label}`);
    assert.strictEqual(typeIconReach(name, 10), 0, `reach of ${label}`);
  }
});

test('a radius that is not a positive number gives no outline and no reach', () => {
  for (const r of [0, -3, NaN, Infinity, undefined, null, '10', {}]) {
    assert.strictEqual(typeIconOutline('star', r), '', String(r));
    assert.strictEqual(typeIconReach('star', r), 0, String(r));
  }
});

test('typeIconOf looks a type up by name, ignoring case and surrounding space, and answers its icon', () => {
  const types = [
    { name: 'objective', color: '#a371f7', icon: 'diamond' },
    { name: 'story', color: '' },
    { name: 'bug', color: '', icon: 'blob' },
    { name: 'Task', color: '', icon: 'triangle' },
  ];
  assert.strictEqual(typeIconOf('objective', types), 'diamond');
  assert.strictEqual(typeIconOf('  Objective ', types), 'diamond');
  assert.strictEqual(typeIconOf('task', types), 'triangle');
  assert.strictEqual(typeIconOf('story', types), '', 'listed without an icon');
  assert.strictEqual(typeIconOf('bug', types), '', 'listed with an unknown icon');
  assert.strictEqual(typeIconOf('spike', types), '', 'not listed');
});

test('typeIconOf answers nothing for a card with no type, or a board with no types list', () => {
  const types = [{ name: 'objective', icon: 'star' }];
  for (const type of [null, undefined, '', '   ']) assert.strictEqual(typeIconOf(type, types), '', JSON.stringify(type));
  for (const list of [undefined, null, [], 'star', {}, 7]) assert.strictEqual(typeIconOf('objective', list), '', JSON.stringify(list));
});

test('typeIconOf takes the first entry of a name, as the chip colour does, and never an icon that is not in the table', () => {
  assert.strictEqual(typeIconOf('a', [{ name: 'a' }, { name: 'a', icon: 'star' }]), '');
  assert.strictEqual(typeIconOf('a', [{ name: 'a', icon: 'star' }, { name: 'a', icon: 'square' }]), 'star');
  for (const icon of ['__proto__', 'constructor', 'toString', '<b>', 'Star', 7, {}, ['star'], null]) {
    assert.strictEqual(typeIconOf('a', [{ name: 'a', icon }]), '', JSON.stringify(icon));
  }
  assert.strictEqual(typeIconOf('a', [null, undefined, 'a', 3, { name: 'a', icon: 'hexagon' }]), 'hexagon', 'a malformed entry is stepped over');
});

test('the module has no dependencies: it loads in a page scope with no require and puts its functions on window', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'type-icons.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /\brequire\s*\(/);
  const window = {};
  vm.runInNewContext(src, { window });
  for (const name of ['typeIconGlyph', 'typeIconOutline', 'typeIconReach', 'typeIconOf']) {
    assert.strictEqual(typeof window[name], 'function', name);
  }
  assert.strictEqual(window.typeIconOutline('diamond', 10), 'M13 0L0 13L-13 0L0 -13Z');
  assert.deepStrictEqual([...window.TYPE_ICON_NAMES], NAMES);
});

test('the module shares no top-level name with any other page script, and declares only type-icon names', () => {
  const webDir = path.join(__dirname, '..', 'web');
  const sources = fs.readdirSync(webDir).filter((f) => f.endsWith('.js')).map((f) => ({ label: f, source: fs.readFileSync(path.join(webDir, f), 'utf8') }));
  const mine = sources.find((s) => s.label === 'type-icons.js');
  assert.ok(mine, 'type-icons.js is one of the page scripts');
  const names = topLevelDeclarations(mine.source);
  assert.ok(names.includes('typeIconGlyph') && names.includes('TYPE_ICON_NAMES'));
  for (const name of names) assert.match(name, /^(TYPE_ICON_|typeIcon)/, `${name} is named for the module`);
  assert.deepStrictEqual(collisions(sources), []);
});
