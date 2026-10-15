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

// --- the fold: kept in the sections store, one boolean beside the graphs' and No relations' ---

function sectionsSandbox({ stored = {}, throws = false, board = 'shop' } = {}) {
  const { storageKey, mergeMapSectionsCollapsed } = require('../web/column-state');
  const writes = {};
  const sandbox = {
    state: { projectName: board },
    storageKey,
    mergeMapSectionsCollapsed,
    renders: 0,
    renderBoard() { sandbox.renders++; },
    writes,
    localStorage: {
      getItem(k) { if (throws) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      setItem(k, v) { if (throws) throw new Error('blocked'); writes[k] = v; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(['let mapSectionsCollapsed = null;', fn('loadMapSectionsCollapsed'), fn('saveMapSectionsCollapsed'), fn('toggleMapSection')].join('\n'), sandbox);
  return sandbox;
}

const SECTIONS_KEY = 'kanban.shop.map.sections.collapsed';
const FOLDED = { graph: false, isolated: false, options: true };

test('a board that has never chosen has the options folded and the two sections open', () => {
  assert.deepStrictEqual(plain(sectionsSandbox().loadMapSectionsCollapsed()), FOLDED);
});

test('unfolding is saved under the sections key, shows at once, and is what the next page load reads', () => {
  const first = sectionsSandbox();
  first.toggleMapSection('options');
  assert.deepStrictEqual(JSON.parse(first.writes[SECTIONS_KEY]), { ...FOLDED, options: false });
  assert.strictEqual(first.renders, 1);
  assert.strictEqual(first.loadMapSectionsCollapsed().options, false);
  const reloaded = sectionsSandbox({ stored: first.writes });
  assert.strictEqual(reloaded.loadMapSectionsCollapsed().options, false);
  assert.strictEqual(reloaded.renders, 0);
});

test('folding it again is saved too', () => {
  const first = sectionsSandbox({ stored: { [SECTIONS_KEY]: JSON.stringify({ ...FOLDED, options: false }) } });
  first.toggleMapSection('options');
  assert.strictEqual(JSON.parse(first.writes[SECTIONS_KEY]).options, true);
  assert.strictEqual(sectionsSandbox({ stored: first.writes }).loadMapSectionsCollapsed().options, true);
});

test('the fold is kept per board', () => {
  const stored = { 'kanban.other.map.sections.collapsed': JSON.stringify({ options: false }) };
  assert.strictEqual(sectionsSandbox({ stored, board: 'shop' }).loadMapSectionsCollapsed().options, true);
  assert.strictEqual(sectionsSandbox({ stored, board: 'other' }).loadMapSectionsCollapsed().options, false);
});

test('folding or unfolding the options leaves the graphs, No relations and the option choices alone', () => {
  const w = sectionsSandbox({ stored: { [SECTIONS_KEY]: JSON.stringify({ graph: true, isolated: true }) } });
  w.toggleMapSection('options');
  assert.deepStrictEqual(JSON.parse(w.writes[SECTIONS_KEY]), { graph: true, isolated: true, options: false });
  assert.deepStrictEqual(Object.keys(w.writes), [SECTIONS_KEY], 'nothing else is written');
  w.toggleMapSection('graph');
  assert.deepStrictEqual(JSON.parse(w.writes[SECTIONS_KEY]), { graph: false, isolated: true, options: false });
});

test('a board whose graphs were folded before the Options toggle existed reads the options as folded', () => {
  const w = sectionsSandbox({ stored: { [SECTIONS_KEY]: JSON.stringify({ graph: true, isolated: false }) } });
  assert.deepStrictEqual(plain(w.loadMapSectionsCollapsed()), { graph: true, isolated: false, options: true });
});

test('corrupt, wrong-shaped or blocked storage reads as folded', () => {
  for (const raw of ['{not json', 'null', '"open"', '42', '[]', '{"options":"no"}', '{"options":0}', '{"options":null}']) {
    assert.strictEqual(sectionsSandbox({ stored: { [SECTIONS_KEY]: raw } }).loadMapSectionsCollapsed().options, true, raw);
  }
  const blocked = sectionsSandbox({ throws: true });
  assert.strictEqual(blocked.loadMapSectionsCollapsed().options, true);
});

test('blocked storage still unfolds for this session, without throwing', () => {
  const w = sectionsSandbox({ throws: true });
  assert.doesNotThrow(() => w.toggleMapSection('options'));
  assert.strictEqual(w.loadMapSectionsCollapsed().options, false);
  assert.strictEqual(w.renders, 1);
});

test('the poll re-renders from the remembered fold: reading again saves nothing and draws nothing', () => {
  const w = sectionsSandbox();
  w.toggleMapSection('options');
  const written = { ...w.writes };
  assert.strictEqual(w.loadMapSectionsCollapsed().options, false);
  assert.deepStrictEqual(w.writes, written);
  assert.strictEqual(w.renders, 1);
});
