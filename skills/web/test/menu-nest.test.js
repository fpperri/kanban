const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../web/menu-nest');

// The rules of the nested card menu (menu-nest.js), apart from the DOM: which separators and groups
// show, where a panel opens, what the arrow keys do, and the hover delays. menu-nest-ui.js draws
// them; card-menu-nest.test.js drives that in the real page.

// --- which rows show -------------------------------------------------------------------------

const row = (shown, sep = false) => ({ shown, sep });
const sep = () => row(true, true);

test('a group whose entries are all out is out itself, and one entry left keeps it', () => {
  assert.strictEqual(m.menuSubShown([false, false]), false);
  assert.strictEqual(m.menuSubShown([]), false);
  assert.strictEqual(m.menuSubShown([false, true]), true);
  assert.strictEqual(m.menuSubShown([true, true, true]), true);
});

test('a separator shows only between two entries that show', () => {
  assert.deepStrictEqual(m.menuSeparators([row(true), sep(), row(true)]), [true, true, true]);
  assert.deepStrictEqual(m.menuSeparators([sep(), row(true)]), [false, true], 'none leads the menu');
  assert.deepStrictEqual(m.menuSeparators([row(true), sep()]), [true, false], 'none trails it');
  assert.deepStrictEqual(m.menuSeparators([row(false), sep(), row(true)]), [false, false, true], 'nothing before it shows');
  assert.deepStrictEqual(m.menuSeparators([row(true), sep(), row(false), sep(), row(true)]), [true, false, false, true, true], 'two in a row are one: the later one stays');
  assert.deepStrictEqual(m.menuSeparators([row(true), sep(), row(false)]), [true, false, false]);
});

test('the card menu\'s own layout: the top three, a separator, the groups, a separator, archive, restore and delete', () => {
  const layout = [row(true), row(false), row(true), sep(), row(true), row(true), row(true), row(false), row(true), sep(), row(true), row(true), row(true)];
  const shown = m.menuSeparators(layout);
  assert.deepStrictEqual([shown[3], shown[9]], [true, true]);
  const bare = [row(false), row(false), row(false), sep(), row(true), row(true), sep(), row(true)];
  assert.deepStrictEqual(m.menuSeparators(bare).filter((_, i) => bare[i].sep), [false, true], 'with the top three out the first separator goes');
});

// --- moving the highlight ------------------------------------------------------------------------

test('Down and Up step the highlight and wrap at the ends, and Down from nothing lands on the first', () => {
  assert.strictEqual(m.menuStep(4, -1, 'ArrowDown'), 0);
  assert.strictEqual(m.menuStep(4, 0, 'ArrowDown'), 1);
  assert.strictEqual(m.menuStep(4, 3, 'ArrowDown'), 0);
  assert.strictEqual(m.menuStep(4, 2, 'ArrowUp'), 1);
  assert.strictEqual(m.menuStep(4, 0, 'ArrowUp'), 3);
  assert.strictEqual(m.menuStep(4, -1, 'ArrowUp'), 3, 'Up from nothing lands on the last');
});

test('a level with no entries has nothing to highlight, and any other key is no step', () => {
  assert.strictEqual(m.menuStep(0, -1, 'ArrowDown'), -1);
  assert.strictEqual(m.menuStep(4, 1, 'ArrowLeft'), 1);
  assert.strictEqual(m.menuStep(4, 1, 'x'), 1);
});

// --- what a key does -------------------------------------------------------------------------------

const top = { level: 'top', onParent: false, subOpen: false };
const onParent = { level: 'top', onParent: true, subOpen: false };
const inSub = { level: 'sub', onParent: false, subOpen: true };

test('Up and Down move the highlight at either level', () => {
  for (const ctx of [top, onParent, inSub]) {
    assert.strictEqual(m.menuKeyAction('ArrowDown', ctx), 'next');
    assert.strictEqual(m.menuKeyAction('ArrowUp', ctx), 'prev');
  }
});

test('Right and Enter on a group row open it and highlight its first entry', () => {
  assert.strictEqual(m.menuKeyAction('ArrowRight', onParent), 'open');
  assert.strictEqual(m.menuKeyAction('Enter', onParent), 'open');
  assert.strictEqual(m.menuKeyAction(' ', onParent), 'open');
});

test('Right and Enter elsewhere are the page\'s: an entry\'s own Enter is its click', () => {
  assert.strictEqual(m.menuKeyAction('ArrowRight', top), null);
  assert.strictEqual(m.menuKeyAction('ArrowRight', inSub), null);
  assert.strictEqual(m.menuKeyAction('Enter', top), null);
  assert.strictEqual(m.menuKeyAction('Enter', inSub), null);
  assert.strictEqual(m.menuKeyAction(' ', inSub), null);
});

test('Left closes the open panel and returns to its row, and does nothing at the top', () => {
  assert.strictEqual(m.menuKeyAction('ArrowLeft', inSub), 'close-sub');
  assert.strictEqual(m.menuKeyAction('ArrowLeft', top), null);
  assert.strictEqual(m.menuKeyAction('ArrowLeft', onParent), null);
});

test('Esc closes the open panel first, and at the top level is left to the page, which closes the menu', () => {
  assert.strictEqual(m.menuKeyAction('Escape', inSub), 'close-sub');
  assert.strictEqual(m.menuKeyAction('Escape', { level: 'top', onParent: true, subOpen: true }), 'close-sub', 'a panel hover-opened, with the row highlighted');
  assert.strictEqual(m.menuKeyAction('Escape', top), null);
  assert.strictEqual(m.menuKeyAction('Escape', onParent), null);
});

test('any other key is the page\'s', () => {
  for (const key of ['a', 'Tab', 'PageDown', 'n', 'Shift']) assert.strictEqual(m.menuKeyAction(key, onParent), null, key);
});

// --- where a panel opens -----------------------------------------------------------------------------

const viewport = { width: 1000, height: 800 };
const parent = (left, top) => ({ left, right: left + 160, top, bottom: top + 28 });
const panel = { width: 180, height: 120 };

test('a panel opens beside its row, on the right when there is room', () => {
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(100, 100), panel, viewport }), { flip: false, shiftY: 0 });
});

test('a panel flips to the left when there is no room on the right and room on the left', () => {
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(700, 100), panel, viewport }), { flip: true, shiftY: 0 });
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(650, 100), panel, viewport }), { flip: false, shiftY: 0 }, 'right edge 810 + 180 = 990, inside the 8px margin: it fits');
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(660, 100), panel, viewport }), { flip: true, shiftY: 0 }, '820 + 180 = 1000 runs into the margin'); 
});

test('with no room on either side the panel keeps the side with more room', () => {
  const narrow = { width: 300, height: 800 };
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(60, 100), panel: { width: 280, height: 100 }, viewport: narrow }).flip, false, 'more to the right');
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(130, 100), panel: { width: 280, height: 100 }, viewport: narrow }).flip, true, 'more to the left');
});

test('a panel that would run off the bottom is lifted by the overflow, not above the top', () => {
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(100, 700), panel, viewport }), { flip: false, shiftY: -28 }, '700 + 120 = 820, 28 over the 792 line');
  assert.deepStrictEqual(m.menuSubPlacement({ parent: parent(100, 20), panel: { width: 180, height: 2000 }, viewport }), { flip: false, shiftY: -12 }, 'never above the 8px margin');
});

// --- hover intent -------------------------------------------------------------------------------------

test('a panel opens after a short delay, and switching to another waits longer, so a diagonal move toward the open one keeps it', () => {
  assert.ok(m.MENU_OPEN_MS > 0 && m.MENU_OPEN_MS < m.MENU_SWITCH_MS);
  assert.strictEqual(m.menuHoverDelay(false), m.MENU_OPEN_MS);
  assert.strictEqual(m.menuHoverDelay(true), m.MENU_SWITCH_MS);
});

test('Home and End go to the first and last entry of the level', () => {
  for (const ctx of [top, onParent, inSub]) {
    assert.strictEqual(m.menuKeyAction('Home', ctx), 'first');
    assert.strictEqual(m.menuKeyAction('End', ctx), 'last');
  }
});
