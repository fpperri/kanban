const { test } = require('node:test');
const assert = require('node:assert');
const {
  VIEW_PANEL_FEATURE, VIEW_PANEL_WIDE_PX, viewPanelDefault, mergeViewPanel, viewPanelOpen, viewPanelWith, loadViewPanel, saveViewPanel,
} = require('../web/view-panel');

// Whether the option panel of the Map and of the Graph is open: the person's choice kept in the
// browser per board, else it starts closed at every width.

function storageOf(initial = {}) {
  const items = { ...initial };
  return {
    items,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => { items[k] = String(v); },
  };
}

const NONE = { map: null, graph: null };

test('the panel starts closed at every width, and 760 px is where it opens beside the view instead of over it', () => {
  assert.strictEqual(VIEW_PANEL_WIDE_PX, 760);
  for (const width of [1280, 760, 759, 400, 0, undefined, 'wide']) assert.strictEqual(viewPanelDefault(width), false, String(width));
});

test('with nothing stored there is no choice, and the panel is closed for each view whatever the width', () => {
  assert.deepStrictEqual(loadViewPanel(storageOf(), 'shop'), NONE);
  assert.deepStrictEqual(mergeViewPanel(null), NONE);
  assert.deepStrictEqual(mergeViewPanel(undefined), NONE);
  assert.deepStrictEqual(mergeViewPanel(''), NONE);
  assert.strictEqual(viewPanelOpen(NONE, 'map', 1280), false);
  assert.strictEqual(viewPanelOpen(NONE, 'graph', 400), false);
});

test('a stored choice beats the default, both ways, for the view it was made in alone', () => {
  const closed = { map: false, graph: null };
  assert.strictEqual(viewPanelOpen(closed, 'map', 1280), false);
  assert.strictEqual(viewPanelOpen(closed, 'graph', 1280), false);
  const open = { map: null, graph: true };
  assert.strictEqual(viewPanelOpen(open, 'graph', 1280), true);
  assert.strictEqual(viewPanelOpen(open, 'graph', 400), true);
  assert.strictEqual(viewPanelOpen(open, 'map', 1280), false);
  assert.strictEqual(viewPanelOpen({ map: true, graph: false }, 'map', 400), true);
});

test('the stored text and the parsed value read the same', () => {
  const choices = { map: true, graph: false };
  assert.deepStrictEqual(mergeViewPanel(JSON.stringify(choices)), choices);
  assert.deepStrictEqual(mergeViewPanel(choices), choices);
});

test('a value that is not a boolean, a key it does not know and text that is not JSON count for nothing', () => {
  assert.deepStrictEqual(mergeViewPanel({ map: 'yes', graph: 1 }), NONE);
  assert.deepStrictEqual(mergeViewPanel({ gantt: true, map: true }), { map: true, graph: null });
  assert.deepStrictEqual(mergeViewPanel('{not json'), NONE);
  assert.deepStrictEqual(mergeViewPanel('[true, false]'), NONE);
  assert.deepStrictEqual(mergeViewPanel('true'), NONE);
  assert.deepStrictEqual(mergeViewPanel({ __proto__: { map: true } }), NONE);
});

test('a change sets one view and leaves the other, and never touches the set passed in', () => {
  const before = { map: null, graph: true };
  assert.deepStrictEqual(viewPanelWith(before, 'map', false), { map: false, graph: true });
  assert.deepStrictEqual(before, { map: null, graph: true });
  assert.deepStrictEqual(viewPanelWith(NONE, 'graph', true), { map: null, graph: true });
});

test('a change the panel cannot make leaves the choices as they were', () => {
  assert.deepStrictEqual(viewPanelWith({ map: true, graph: null }, 'gantt', false), { map: true, graph: null });
  assert.deepStrictEqual(viewPanelWith({ map: true, graph: null }, 'map', 'closed'), { map: true, graph: null });
  assert.deepStrictEqual(viewPanelWith({ map: true, graph: null }, 'map', undefined), { map: true, graph: null });
});

test('a choice is kept per board under its own key and comes back in the same browser', () => {
  const storage = storageOf();
  saveViewPanel(storage, 'shop', viewPanelWith(NONE, 'map', false));
  assert.deepStrictEqual(Object.keys(storage.items), [`kanban.shop.${VIEW_PANEL_FEATURE}`]);
  assert.strictEqual(VIEW_PANEL_FEATURE, 'viewpanel');
  assert.deepStrictEqual(loadViewPanel(storage, 'shop'), { map: false, graph: null });
  assert.deepStrictEqual(loadViewPanel(storage, 'other'), NONE, 'another board keeps its own');
});

test('a stored value that was hand-edited reads as no choice, not as an error', () => {
  const storage = storageOf({ 'kanban.shop.viewpanel': '{"map": "open", "graph": false}' });
  assert.deepStrictEqual(loadViewPanel(storage, 'shop'), { map: null, graph: false });
});

test('storage that refuses a read or a write gives no choice and does not throw', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  assert.deepStrictEqual(loadViewPanel(blocked, 'shop'), NONE);
  assert.doesNotThrow(() => saveViewPanel(blocked, 'shop', { map: true, graph: true }));
});
