const { test } = require('node:test');
const assert = require('node:assert');
const { MAP_OPTION_VALUES, MAP_OPTION_DEFAULTS, mergeMapOptions } = require('../web/map-relations');

const CHOSEN = {
  parentLines: 'chain', depLines: 'on', group: 'tree', parent: 'below',
  align: 'center', order: 'status', relayout: 'keep', cards: 'rich',
};

test('the defaults are the chain-ends, one-graph-per-tree reading', () => {
  assert.deepStrictEqual({ ...MAP_OPTION_DEFAULTS }, CHOSEN);
});

test('every option offers its default first and only the documented values', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(MAP_OPTION_VALUES)), {
    parentLines: ['chain', 'all', 'off'],
    depLines: ['on', 'off'],
    group: ['tree', 'one'],
    parent: ['below', 'above'],
    align: ['center', 'left'],
    order: ['status', 'layout'],
    relayout: ['keep', 'reflow'],
    cards: ['rich', 'plain'],
  });
});

test('nothing saved merges to the defaults', () => {
  assert.deepStrictEqual(mergeMapOptions(null), CHOSEN);
  assert.deepStrictEqual(mergeMapOptions(undefined), CHOSEN);
  assert.deepStrictEqual(mergeMapOptions({}), CHOSEN);
});

test('a saved choice wins over its default, the rest keep theirs', () => {
  assert.deepStrictEqual(mergeMapOptions({ parent: 'above', cards: 'plain' }), { ...CHOSEN, parent: 'above', cards: 'plain' });
});

test('a value this version does not offer falls back to the default', () => {
  assert.deepStrictEqual(mergeMapOptions({ parentLines: 'everything', align: 'right', depLines: true }), CHOSEN);
});

test('keys this version does not know are dropped', () => {
  const merged = mergeMapOptions({ group: 'one', legacy: 'x', __proto__: { align: 'left' } });
  assert.deepStrictEqual(merged, { ...CHOSEN, group: 'one' });
  assert.ok(!('legacy' in merged));
});

test('anything that is not a plain object merges to the defaults', () => {
  for (const junk of ['chain', 7, true, ['parent', 'above'], () => ({ parent: 'above' })]) {
    assert.deepStrictEqual(mergeMapOptions(junk), CHOSEN, String(junk));
  }
});

test('each merge hands back a fresh object, so a toggle never edits the defaults', () => {
  const a = mergeMapOptions(null);
  a.parent = 'above';
  assert.strictEqual(mergeMapOptions(null).parent, 'below');
  assert.strictEqual(MAP_OPTION_DEFAULTS.parent, 'below');
});
