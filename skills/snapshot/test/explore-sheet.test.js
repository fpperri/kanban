const { test } = require('node:test');
const assert = require('node:assert');
const { withBuiltBoard, withBoardPage, shownIds } = require('./search-table');

// The card sheet offers the four sets Explore adds in kanban-web, in place of its two Dependency
// buttons: Hierarchy path, Hierarchy tree, Dependency path and Dependency tree. Each writes its term
// into the search box and closes the sheet, as the two buttons did, and the page answers the term as
// kanban-web does (search-parity.test.js holds the table of answers).

const sheetButtons = (page) => page.byId('modalscroll').all().filter((n) => n.dataset.act === 'graphfocus');
const tile = (page, id) => page.byId('board').all().find((n) => n.classList.contains('card') && n.dataset.card === String(id));
const openSheet = (page, id) => { page.type(page.byId('q'), ''); page.click(tile(page, id)); };

test('the sheet has the four buttons, Hierarchy path and tree then Dependency path and tree, each writing its own term', () => {
  withBuiltBoard('plan', (page) => {
    openSheet(page, 3);
    const buttons = sheetButtons(page);
    assert.deepStrictEqual(buttons.map((b) => [b.textContent, b.dataset.gk]), [
      ['Hierarchy path', 'hpath'], ['Hierarchy tree', 'htree'], ['Dependency path', 'dpath'], ['Dependency tree', 'dtree'],
    ]);
  });
});

test('each button writes its term for the card into the search box and closes the sheet, and the board shows that set', () => {
  const expected = { hpath: [1, 3], htree: [1, 2, 3, 4, 5, 6, 7, 8, 22, 23, 24, 25], dpath: [3, 4, 6], dtree: [2, 3, 4, 5, 6, 27] };
  for (const [gk, ids] of Object.entries(expected)) {
    withBuiltBoard('plan', (page) => {
      openSheet(page, 3);
      page.click(sheetButtons(page).find((b) => b.dataset.gk === gk));
      assert.strictEqual(page.byId('q').value, `${gk}:3`);
      assert.strictEqual(sheetButtons(page).length, 0, 'the sheet is closed');
      assert.deepStrictEqual(shownIds(page), ids, gk);
    });
  }
});

test('the two old buttons are gone: nothing writes tree: or path: from the sheet', () => {
  withBuiltBoard('plan', (page) => {
    openSheet(page, 3);
    assert.deepStrictEqual(sheetButtons(page).filter((b) => b.dataset.gk === 'tree' || b.dataset.gk === 'path'), []);
  });
});

test('an archived card\'s read-only sheet has the four too, since they only read', () => {
  withBoardPage('plan', (page) => {
    page.click(tile(page, 19));
    assert.deepStrictEqual(sheetButtons(page).map((b) => b.dataset.gk), ['hpath', 'htree', 'dpath', 'dtree']);
    page.click(sheetButtons(page).find((b) => b.dataset.gk === 'hpath'));
    assert.strictEqual(page.byId('q').value, 'hpath:19');
    assert.deepStrictEqual(shownIds(page), [1, 2, 19]);
  });
});

test('a card queued to be created has no id yet, so its sheet has none of the four', () => {
  withBuiltBoard('plan', (page) => {
    page.click(page.byId('newbtn'));
    assert.deepStrictEqual(sheetButtons(page), []);
  });
});

// --- the sets themselves: the page's own four functions answer as kanban-web's do -----------------------

test('the page\'s four sets match kanban-web\'s for every card of a board with a loop, a self-link, a missing card, another board\'s parent and an archived child', () => {
  const { board, open } = require('./nesting-view');
  const web = require('../../web/web/explore-sets');
  const live = [
    [1, 'todo', 'Root'], [2, 'todo', 'Under 1', { parent: 1 }], [3, 'todo', 'Under 1, waits for 2', { parent: 1, waiting_for: '[2]' }],
    [4, 'todo', 'Under 3', { parent: 3 }], [5, 'todo', 'Waits for 4 and a missing card', { waiting_for: '[4, 99]' }],
    [6, 'todo', 'Own name', { parent: 'order#2' }], [7, 'todo', 'Another board', { parent: '"fpp#1"' }],
    [8, 'todo', 'Loop a', { parent: 9 }], [9, 'todo', 'Loop b', { parent: 8 }], [10, 'todo', 'Self parent', { parent: 10 }],
    [11, 'todo', 'Self wait', { waiting_for: '[11]' }], [12, 'todo', 'Wait loop a', { waiting_for: '[13]' }], [13, 'todo', 'Wait loop b', { waiting_for: '[12]' }],
  ];
  const gone = [[14, 'done', 'Archived child of 2', { parent: 2 }]];
  const asWeb = ([id, , , extra = {}], archived) => ({
    id: String(id), parent: extra.parent === undefined ? null : String(extra.parent).replace(/"/g, ''), archived,
    waiting_for: extra.waiting_for ? JSON.parse(extra.waiting_for).map(String) : [],
  });
  const cards = live.map((r) => asWeb(r, false)).concat(gone.map((r) => asWeb(r, true)));
  open(board('', live, gone), (page) => {
    for (const id of cards.map((c) => c.id).concat(['99', '15'])) {
      for (const [name, fn] of [['hpathIds', web.hpathIds], ['htreeIds', web.htreeIds], ['dpathIds', web.dpathIds], ['dtreeIds', web.dtreeIds]]) {
        const onPage = JSON.parse(page.run(`JSON.stringify([...${name}(searchUniverse(), ${JSON.stringify(id)}, searchCtx)].sort())`));
        assert.deepStrictEqual(onPage, [...fn(cards, id, { board: 'order' })].sort(), `${name}(${id})`);
      }
    }
    assert.deepStrictEqual(JSON.parse(page.run('JSON.stringify([...htreeIds(searchUniverse(), "4", searchCtx)].sort())')), ['1', '14', '2', '3', '4', '6'], 'sanity: the own-name child and the archived child are in the tree');
  });
});
