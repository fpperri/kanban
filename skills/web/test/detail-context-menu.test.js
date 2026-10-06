const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function menuSandbox({ detailId = null, selected = [], textSelected = false } = {}) {
  const calls = { renderBoard: 0, menu: [] };
  const sandbox = {
    currentDetailId: detailId,
    selectedIds: new Set(selected),
    selectionAnchor: null,
    contextSelection: require('../web/selection').contextSelection,
    window: { getSelection: () => ({ isCollapsed: !textSelected }) },
    renderBoard: () => { calls.renderBoard++; },
    showContextMenu: (x, y) => { calls.menu.push([x, y]); },
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext([fn('openCardContextMenu'), fn('onDetailContextMenu')].join('\n'), sandbox);
  return sandbox;
}

const rightClick = (extra) => {
  const e = { clientX: 40, clientY: 90, defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
  return e;
};

test('right-clicking the card detail opens the card menu for that card, as a tile does', () => {
  const s = menuSandbox({ detailId: 7 });
  const e = rightClick();
  s.onDetailContextMenu(e);
  assert.strictEqual(e.prevented, true, 'the browser menu is replaced');
  assert.deepStrictEqual(s.calls.menu, [[40, 90]]);
  assert.deepStrictEqual([...s.selectedIds], [7], 'the card shown becomes the selection');
  assert.strictEqual(s.selectionAnchor, 7);
  assert.strictEqual(s.calls.renderBoard, 1);
});

test('a card already in a batch keeps the whole batch as the menu\'s subject', () => {
  const s = menuSandbox({ detailId: 7, selected: [7, 8] });
  s.onDetailContextMenu(rightClick());
  assert.deepStrictEqual([...s.selectedIds], [7, 8]);
  assert.strictEqual(s.calls.renderBoard, 0);
  assert.strictEqual(s.calls.menu.length, 1);
});

test('with text selected the browser\'s own menu shows', () => {
  const s = menuSandbox({ detailId: 7, textSelected: true });
  const e = rightClick();
  s.onDetailContextMenu(e);
  assert.strictEqual(e.prevented, false);
  assert.deepStrictEqual(s.calls.menu, []);
  assert.strictEqual(s.selectedIds.size, 0, 'the selection is left alone');
});

test('a right-click something else already handled, such as a mention with its own menu, keeps that behaviour', () => {
  const s = menuSandbox({ detailId: 7 });
  const e = rightClick({ defaultPrevented: true });
  s.onDetailContextMenu(e);
  assert.deepStrictEqual(s.calls.menu, []);
  assert.strictEqual(s.selectedIds.size, 0);
});

test('with no card open the handler does nothing', () => {
  const s = menuSandbox({ detailId: null });
  const e = rightClick();
  s.onDetailContextMenu(e);
  assert.strictEqual(e.prevented, false);
  assert.deepStrictEqual(s.calls.menu, []);
});

test('the popup\'s panel carries the handler, so the scrim around it keeps the browser menu', () => {
  assert.match(appSrc, /\$\('#detail-modal \.modal'\)\.addEventListener\('contextmenu', onDetailContextMenu\);/);
});

test('the board\'s own right-click goes through the same helper', () => {
  const body = appSrc.match(/document\.addEventListener\('contextmenu', \(e\) => \{[\s\S]*?\n  \}\);/)[0];
  assert.match(body, /isDragging \|\| ganttDrag \|\| calTimeDrag/);
  assert.match(body, /openCardContextMenu\(e, Number\(el\.dataset\.id\)\)/);
});

// --- the popup stays true after a menu action ---------------------------------------

function refreshSandbox({ detailId, cards }) {
  const calls = { open: [], closed: 0 };
  const sandbox = {
    currentDetailId: detailId,
    state: { active: cards, archived: [] },
    openDetailModal: (id, opts) => { calls.open.push([id, opts]); },
    closeCard: () => { calls.closed++; },
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('refreshOpenDetail'), sandbox);
  return sandbox;
}

test('after the board reloads, the open popup is read again so it shows what the menu changed', () => {
  const s = refreshSandbox({ detailId: 7, cards: [{ id: 7 }] });
  s.refreshOpenDetail();
  assert.strictEqual(s.calls.open.length, 1);
  assert.strictEqual(s.calls.open[0][0], 7);
  assert.strictEqual(s.calls.open[0][1].quiet, true, 'a failed read closes quietly instead of toasting');
  assert.strictEqual(s.calls.closed, 0);
});

test('a card the menu deleted closes its popup', () => {
  const s = refreshSandbox({ detailId: 7, cards: [{ id: 8 }] });
  s.refreshOpenDetail();
  assert.deepStrictEqual(s.calls.open, []);
  assert.strictEqual(s.calls.closed, 1);
});

test('with no popup open a reload leaves it alone', () => {
  const s = refreshSandbox({ detailId: null, cards: [{ id: 7 }] });
  s.refreshOpenDetail();
  assert.deepStrictEqual(s.calls.open, []);
  assert.strictEqual(s.calls.closed, 0);
});

test('loadBoard refreshes the popup once the new board is applied', () => {
  const body = fn('loadBoard');
  assert.ok(body.indexOf('applyBoardData(') > -1 && body.indexOf('applyBoardData(') < body.indexOf('refreshOpenDetail()'));
});

test('a right-click on a link or an image in the detail keeps the browser menu', () => {
  for (const tag of ['a', 'img']) {
    const s = menuSandbox({ detailId: 7 });
    const e = rightClick({ target: { closest: (sel) => (sel === 'a, img' ? { tagName: tag } : null) } });
    s.onDetailContextMenu(e);
    assert.deepStrictEqual(s.calls.menu, []);
    assert.strictEqual(e.prevented, false);
  }
});
