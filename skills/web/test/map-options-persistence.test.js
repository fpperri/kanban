const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// The real functions against a fake localStorage: what a board's options do
// across a reload, a poll tick and a second board is what is under test.
function optionsSandbox({ stored = {}, throws = false, board = 'shop' } = {}) {
  const { storageKey } = require('../web/column-state');
  const { mergeMapOptions, MAP_OPTION_VALUES } = require('../web/map-relations');
  const writes = {};
  const sandbox = {
    state: { projectName: board },
    storageKey,
    mergeMapOptions,
    MAP_OPTION_VALUES,
    renders: 0,
    renderBoard() { sandbox.renders++; },
    writes,
    localStorage: {
      getItem(k) { if (throws) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      setItem(k, v) { if (throws) throw new Error('blocked'); writes[k] = v; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(['let mapOptions = null;', fn('loadMapOptions'), fn('saveMapOptions'), fn('setMapOption')].join('\n'), sandbox);
  return sandbox;
}

const KEY = 'kanban.shop.map.options';
const plain = (v) => JSON.parse(JSON.stringify(v));
const CHOSEN = { parentLines: 'chain', depLines: 'on', group: 'tree', parent: 'below', align: 'center', order: 'status', relayout: 'keep', cards: 'rich' };

test('a board that has never chosen gets the defaults', () => {
  assert.deepStrictEqual(plain(optionsSandbox().loadMapOptions()), CHOSEN);
});

test('a saved choice is read back, and the rest stays at its default', () => {
  const w = optionsSandbox({ stored: { [KEY]: JSON.stringify({ parent: 'above', cards: 'plain' }) } });
  assert.deepStrictEqual(plain(w.loadMapOptions()), { ...CHOSEN, parent: 'above', cards: 'plain' });
});

test('the options are kept per board', () => {
  const stored = { 'kanban.other.map.options': JSON.stringify({ group: 'one' }) };
  assert.strictEqual(optionsSandbox({ stored, board: 'shop' }).loadMapOptions().group, 'tree');
  assert.strictEqual(optionsSandbox({ stored, board: 'other' }).loadMapOptions().group, 'one');
});

test('a value this version does not offer, or text that is not JSON, reads as the defaults', () => {
  assert.deepStrictEqual(plain(optionsSandbox({ stored: { [KEY]: JSON.stringify({ align: 'right' }) } }).loadMapOptions()), CHOSEN);
  assert.deepStrictEqual(plain(optionsSandbox({ stored: { [KEY]: '{not json' } }).loadMapOptions()), CHOSEN);
  assert.deepStrictEqual(plain(optionsSandbox({ stored: { [KEY]: 'null' } }).loadMapOptions()), CHOSEN);
});

test('storage that refuses reads and writes leaves the defaults, and a change still shows this session', () => {
  const w = optionsSandbox({ throws: true });
  assert.deepStrictEqual(plain(w.loadMapOptions()), CHOSEN);
  assert.doesNotThrow(() => w.setMapOption('parent', 'above'));
  assert.strictEqual(w.loadMapOptions().parent, 'above');
  assert.strictEqual(w.renders, 1);
});

test('a change is saved whole, shows at once, and is what the next page load reads', () => {
  const first = optionsSandbox();
  first.setMapOption('parentLines', 'all');
  assert.deepStrictEqual(JSON.parse(first.writes[KEY]), { ...CHOSEN, parentLines: 'all' });
  assert.strictEqual(first.renders, 1);
  assert.strictEqual(first.loadMapOptions().parentLines, 'all');
  const reloaded = optionsSandbox({ stored: first.writes });
  assert.strictEqual(reloaded.loadMapOptions().parentLines, 'all');
});

test('each of the eight options survives a reload on its own', () => {
  const { MAP_OPTION_VALUES } = require('../web/map-relations');
  for (const [key, values] of Object.entries(MAP_OPTION_VALUES)) {
    const other = values[values.length - 1];
    const first = optionsSandbox();
    first.setMapOption(key, other);
    const reloaded = optionsSandbox({ stored: first.writes }).loadMapOptions();
    assert.deepStrictEqual(plain(reloaded), { ...CHOSEN, [key]: other }, key);
  }
});

test('the poll re-renders from the remembered options: reading again gives the same choices', () => {
  const w = optionsSandbox();
  w.setMapOption('order', 'layout');
  const before = plain(w.loadMapOptions());
  const written = { ...w.writes };
  assert.deepStrictEqual(plain(w.loadMapOptions()), before);
  assert.deepStrictEqual(w.writes, written, 'reading saves nothing');
  assert.strictEqual(w.renders, 1, 'reading draws nothing');
});

test('an unknown option or an unoffered value changes nothing: no save, no redraw', () => {
  const w = optionsSandbox();
  w.setMapOption('colour', 'red');
  w.setMapOption('align', 'right');
  w.setMapOption('align', undefined);
  assert.deepStrictEqual(w.writes, {});
  assert.strictEqual(w.renders, 0);
  assert.strictEqual(w.loadMapOptions().align, 'center');
});

test('a renamed board drops the remembered options so the next read uses the right board key', () => {
  const body = fn('applyProjectName');
  assert.match(body, /mapOptions = null;/);
  assert.ok(body.indexOf('mapOptions = null;') < body.indexOf('state.projectName = next;'), 'reset before the new name lands');
});

test('the poll\'s redraw leaves the remembered options alone', () => {
  assert.doesNotMatch(fn('renderMapView'), /mapOptions = null/);
});
