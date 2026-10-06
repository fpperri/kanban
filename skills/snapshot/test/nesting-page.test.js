const { test, describe } = require('node:test');
const assert = require('node:assert');
const { BOARD, card, withSnapshot } = require('./nesting-fixture');
const { loadPage, byClass } = require('./page-harness');

// The snapshot page, run for real against a stand-in DOM: type chips, outline
// order, roll-ups on parent cards and the thread in a card's sheet.

const WIDE = { matchMedia: (q) => q.includes('min-width:900px') };

function open(board, fn) {
  return withSnapshot(board, (html, dir) => fn(loadPage(html, WIDE), dir));
}

const tiles = (page) => page.byId('board').all().filter((n) => n.classList.contains('card'));
const tile = (page, id) => tiles(page).find((n) => n.dataset.card === String(id));
const column = (page, status) => page.byId('board').all()
  .find((n) => n.classList.contains('boardcol') && n.dataset.status === status);
const idsIn = (page, status) => byClass(column(page, status), 'card').map((n) => Number(n.dataset.card));

function sheet(page, id) {
  page.click(tile(page, id));
  return page.byId('modalscroll').children[0];
}

describe('type chips', () => {
  test('a card with a type wears a chip with that word', () => {
    open(BOARD, (page) => {
      const chips = byClass(tile(page, 2), 'type-chip');
      assert.strictEqual(chips.length, 1);
      assert.strictEqual(chips[0].textContent, 'epic');
    });
  });

  test('a configured color paints the chip, through the style object, never a style string', () => {
    open(BOARD, (page) => {
      const [chip] = byClass(tile(page, 1), 'type-chip');
      assert.strictEqual(chip.style.color, '#a371f7');
      assert.strictEqual(chip.style.borderColor, '#a371f7');
      assert.strictEqual(chip.attrs.style, undefined);
    });
  });

  test('a type with no color, and a type the list does not name, stay neutral', () => {
    const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd', { type: 'saga' }) } };
    open(board, (page) => {
      for (const id of [2, 4, 12]) {
        const [chip] = byClass(tile(page, id), 'type-chip');
        assert.ok(chip, `card ${id} has a chip`);
        assert.strictEqual(chip.style.color, undefined, `card ${id}: no inline color`);
      }
    });
  });

  test('the configured color is found whatever the case of the name or of the card type', () => {
    const board = { ...BOARD, config: BOARD.config.replace('name: epic', 'name: Epic\n    color: orange') };
    open(board, (page) => assert.strictEqual(byClass(tile(page, 2), 'type-chip')[0].style.color, 'orange'));
    const upper = { ...board, cards: { ...board.cards, '0002.build.card.md': card(2, 'doing', 'Build', { type: 'EPIC', parent: 1, rank: 20 }) } };
    open(upper, (page) => assert.strictEqual(byClass(tile(page, 2), 'type-chip')[0].style.color, 'orange'));
  });

  test('a card without a type has no chip', () => {
    open(BOARD, (page) => assert.strictEqual(byClass(tile(page, 8), 'type-chip').length, 0));
  });

  test('the chip shows in the card sheet too, and a type that looks like markup stays text', () => {
    const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd', { type: '"<b>x</b>"' }) } };
    open(board, (page) => {
      const [chip] = byClass(sheet(page, 12), 'type-chip');
      assert.strictEqual(chip.textContent, '<b>x</b>');
      assert.strictEqual(chip.children.length, 0);
    });
  });
});

describe('searching by type', () => {
  test('type:epic keeps the epics and nothing else', () => {
    open(BOARD, (page) => {
      page.type(page.byId('q'), 'type:epic');
      assert.deepStrictEqual(tiles(page).map((n) => Number(n.dataset.card)).sort((a, b) => a - b), [2, 3]);
    });
  });

  test('type: is case-insensitive and never matches the title or body', () => {
    open(BOARD, (page) => {
      page.type(page.byId('q'), 'type:STORY');
      assert.deepStrictEqual(tiles(page).map((n) => Number(n.dataset.card)).sort((a, b) => a - b), [4, 5, 6, 7]);
      page.type(page.byId('q'), 'type:build');
      assert.strictEqual(tiles(page).length, 0);
    });
  });

  test('a bare type: (nothing typed yet) filters nothing out', () => {
    open(BOARD, (page) => {
      page.type(page.byId('q'), 'type:');
      assert.strictEqual(tiles(page).length, 10);
    });
  });
});

function board(config, cards, archived) {
  const files = {};
  for (const [id, status, title, extra] of cards) files[`${String(id).padStart(4, '0')}.c.card.md`] = card(id, status, title, extra);
  const arch = {};
  for (const [id, status, title, extra] of archived || []) arch[`${String(id).padStart(4, '0')}.c.card.md`] = card(id, status, title, extra);
  return { config: `name: order\nstatuses: [todo, done]\n${config || ''}`, cards: files, archived: archived ? arch : undefined };
}

describe('outline order', () => {
  const NESTED = board('', [
    [1, 'todo', 'Later root'],
    [2, 'todo', 'Second child', { parent: 3, rank: 20 }],
    [3, 'todo', 'Parent'],
    [4, 'todo', 'First child', { parent: 3, rank: 10 }],
    [5, 'todo', 'Flat'],
  ]);

  test('parents come before their children, siblings follow their rank', () => {
    open(NESTED, (page) => assert.deepStrictEqual(idsIn(page, 'todo'), [1, 3, 4, 2, 5]));
  });

  test('each column follows the order of the whole board, whichever column a child sits in', () => {
    const split = board('', [
      [1, 'todo', 'Root'], [2, 'done', 'Done child', { parent: 1, rank: 10 }],
      [3, 'todo', 'Todo child', { parent: 1, rank: 20 }], [4, 'todo', 'Other root'],
    ]);
    open(split, (page) => {
      assert.deepStrictEqual(idsIn(page, 'todo'), [1, 3, 4]);
      assert.deepStrictEqual(idsIn(page, 'done'), [2]);
    });
  });

  test('unranked siblings fall back to the board\'s priority order, then id', () => {
    const cards = [[1, 'todo', 'Parent'], [2, 'todo', 'Normal child', { parent: 1 }], [3, 'todo', 'Urgent child', { parent: 1, priority: 'Urgent' }]];
    open(board('', cards), (page) => assert.deepStrictEqual(idsIn(page, 'todo'), [1, 2, 3]));
    open(board('priorities: [Urgent, Normal]\n', cards), (page) => assert.deepStrictEqual(idsIn(page, 'todo'), [1, 3, 2]));
  });

  test('a board with neither rank nor parent keeps the order it always had', () => {
    const flat = board('', [[1, 'todo', 'One'], [2, 'todo', 'Two'], [3, 'todo', 'Three', { priority: 'High' }]]);
    open(flat, (page) => assert.deepStrictEqual(idsIn(page, 'todo'), [1, 2, 3]));
  });

  test('the Archive section follows outline order too', () => {
    const withArchive = board('', [[1, 'todo', 'Live']], [
      [8, 'done', 'Arch child', { parent: 9, rank: 10 }], [9, 'done', 'Arch parent'],
    ]);
    open(withArchive, (page) => {
      page.run('statusVis.archive=true;colOpen["archive"]=true;render()');
      const archive = page.byId('board').all().filter((n) => n.classList.contains('boardcol')).pop();
      assert.deepStrictEqual(byClass(archive, 'card').map((n) => Number(n.dataset.card)), [9, 8]);
    });
  });

  test('a queued parent change reorders the board on the next render', () => {
    open(NESTED, (page) => {
      page.run('queue({op:"edit",id:"5",fm:{parent:"1"}});render()');
      assert.deepStrictEqual(idsIn(page, 'todo'), [1, 5, 3, 4, 2]);
    });
  });

  test('a card created in the tray, not yet on disk, lands after the ordered cards', () => {
    open(NESTED, (page) => {
      page.run('queue({op:"create",title:"Fresh",status:"todo"});render()');
      const ids = byClass(column(page, 'todo'), 'card').map((n) => n.dataset.card);
      assert.deepStrictEqual(ids, ['1', '3', '4', '2', '5', 'n1']);
    });
  });
});

describe('roll-ups on parent cards', () => {
  const countsOf = (node) => Object.fromEntries(byClass(node, 'rollup-seg').map((s) => {
    const [status, n] = s.title.split(': ');
    return [status, Number(n)];
  }));

  test('a parent tile shows its altitude and a thin bar of the leaves below, a leaf shows neither', () => {
    open(BOARD, (page) => {
      const root = tile(page, 1);
      assert.deepStrictEqual(byClass(root, 'alt-badge').map((n) => n.textContent), ['\u25b22']);
      const [bar] = byClass(root, 'rollup-bar');
      assert.ok(bar.classList.contains('thin'));
      assert.deepStrictEqual(countsOf(root), { backlog: 1, todo: 1, doing: 1, done: 2 });
      assert.strictEqual(byClass(root, 'rollup-counts').length, 0, 'numbers are for the sheet');
      for (const id of [4, 8]) {
        assert.strictEqual(byClass(tile(page, id), 'alt-badge').length, 0);
        assert.strictEqual(byClass(tile(page, id), 'rollup').length, 0);
      }
    });
  });

  test('each segment is weighted by its count and colored like its status column', () => {
    open(BOARD, (page) => {
      const segs = byClass(tile(page, 1), 'rollup-seg');
      const done = segs.find((s) => s.title === 'done: 2');
      assert.strictEqual(Number(done.style.flexGrow), 2);
      assert.strictEqual(done.style.background, 'var(--st-done)');
      assert.strictEqual(segs.find((s) => s.title === 'todo: 1').style.background, 'var(--st-todo)');
    });
  });

  test('segments follow the board\'s own status order', () => {
    open(BOARD, (page) => {
      assert.deepStrictEqual(byClass(tile(page, 1), 'rollup-seg').map((s) => s.title.split(': ')[0]), ['backlog', 'todo', 'doing', 'done']);
    });
  });

  test('an archived leaf counts as done, so archiving finished work never sets a parent back', () => {
    open(BOARD, (page) => {
      assert.strictEqual(countsOf(tile(page, 2)).done, 2, 'card 4 is done and card 9 is archived');
    });
  });

  test('the sheet opens the bar with its numbers, the leaves counted and where they were counted', () => {
    open(BOARD, (page) => {
      const box = byClass(sheet(page, 1), 'detail-rollup')[0];
      assert.ok(box, 'the sheet has a roll-up block');
      assert.strictEqual(byClass(box, 'rollup-bar')[0].classList.contains('thin'), false);
      assert.strictEqual(byClass(box, 'rollup-total')[0].textContent, '5');
      assert.deepStrictEqual(byClass(box, 'rollup-count').map((n) => n.textContent), ['2 done', '1 backlog', '1 todo', '1 doing']);
      assert.deepStrictEqual(byClass(box, 'alt-badge').map((n) => n.textContent), ['\u25b22']);
      assert.strictEqual(byClass(box, 'rollup-scope')[0].textContent, 'Counted on this board only (fixture). Archived leaves count as done.');
    });
  });

  test('a leaf\'s sheet has no roll-up block', () => {
    open(BOARD, (page) => assert.strictEqual(byClass(sheet(page, 4), 'detail-rollup').length, 0));
  });

  test('a parent loop never hangs the page and counts nothing', () => {
    const loop = board('', [[1, 'todo', 'A', { parent: 2 }], [2, 'todo', 'B', { parent: 1 }]]);
    open(loop, (page) => {
      assert.strictEqual(byClass(tile(page, 1), 'rollup-seg').length, 0);
      assert.match(byClass(sheet(page, 1), 'rollup-empty')[0].textContent, /No leaves counted/);
    });
  });

  test('the counts are the ones kanban-web reports for the same board', () => {
    const cardStore = require('../../web/scripts/card-store');
    const { rollupIndex } = require('../../web/web/nesting');
    open(BOARD, (page, dir) => {
      const webCards = cardStore.listActive(dir).concat(cardStore.listArchived(dir)).map(cardStore.toJSON);
      const web = rollupIndex(webCards, { board: 'fixture', priorities: [] });
      const parents = web.parents();
      assert.deepStrictEqual(parents.slice().sort(), [1, 2, 3]);
      for (const id of parents) {
        const expected = web.rollup(id);
        const root = tile(page, id);
        assert.deepStrictEqual(countsOf(root), { ...expected.counts }, `card ${id}: counts`);
        assert.deepStrictEqual(byClass(root, 'alt-badge').map((n) => n.textContent), [`\u25b2${web.altitudeOf(id)}`], `card ${id}: altitude`);
        assert.strictEqual(Number(byClass(sheet(page, id), 'rollup-total')[0].textContent), expected.total, `card ${id}: total`);
      }
    });
  });
});

describe('the thread and the children in a card sheet', () => {
  const entries = (node, cls) => byClass(node, cls).map((li) => li.textContent);

  test('the sheet shows the thread up to the root, root first, above the card', () => {
    open(BOARD, (page) => {
      const s = sheet(page, 4);
      const [thread] = byClass(s, 'thread-list');
      assert.deepStrictEqual(entries(thread, 'thread-item'), ['fixture#1 Ship it', 'fixture#2 Build']);
      const title = s.children.find((n) => n.classList.contains('ttl'));
      assert.ok(s.children.indexOf(thread.parentNode) < s.children.indexOf(title), 'the thread sits above the title');
    });
  });

  test('tapping a card in the thread opens it', () => {
    open(BOARD, (page) => {
      const s = sheet(page, 4);
      const chip = byClass(s, 'thread-item').map((li) => li.children[0]).find((n) => n.textContent === 'fixture#1 Ship it');
      assert.strictEqual(chip.dataset.mapnode, '1');
      page.click(chip);
      assert.strictEqual(byClass(page.byId('modalscroll'), 'ttl')[0].textContent, 'Ship it');
    });
  });

  test('a root has no thread', () => {
    open(BOARD, (page) => assert.strictEqual(byClass(sheet(page, 1), 'thread-list').length, 0));
  });

  test('a parent that is not on the board ends the thread with an unresolved marker, and opens nothing', () => {
    open(BOARD, (page) => {
      const [item] = byClass(sheet(page, 11), 'thread-item');
      assert.strictEqual(item.textContent, 'fixture#99unresolved');
      assert.strictEqual(byClass(item, 'rel-mark')[0].textContent, 'unresolved');
      assert.strictEqual(item.children[0].dataset.mapnode, undefined);
    });
  });

  test('a parent on another board is named, marked not followed, and opens nothing', () => {
    open(BOARD, (page) => {
      const [item] = byClass(sheet(page, 10), 'thread-item');
      assert.strictEqual(item.children[0].textContent, 'fpp#4');
      assert.strictEqual(byClass(item, 'rel-mark')[0].textContent, 'not followed');
      assert.strictEqual(item.children[0].dataset.mapnode, undefined);
    });
  });

  test('a loop of parents stops at the card that repeats and flags it', () => {
    const loop = board('', [[1, 'todo', 'A', { parent: 2 }], [2, 'todo', 'B', { parent: 1 }]]);
    open(loop, (page) => {
      const items = byClass(sheet(page, 1), 'thread-item');
      assert.deepStrictEqual(items.map((li) => li.children[0].textContent), ['order#1 A', 'order#2 B']);
      assert.deepStrictEqual(byClass(items[0], 'rel-mark').map((n) => n.textContent), ['loop']);
      assert.deepStrictEqual(byClass(items[1], 'rel-mark'), []);
    });
  });

  test('the sheet lists a parent\'s children in rank order, archived ones marked, and a tap opens one', () => {
    open(BOARD, (page) => {
      const s = sheet(page, 2);
      const items = byClass(s, 'child-item');
      assert.deepStrictEqual(items.map((li) => li.children[0].textContent), ['fixture#4 Write code', 'fixture#5 Review code', 'fixture#9 Shipped']);
      assert.deepStrictEqual(items.map((li) => byClass(li, 'rel-mark').map((n) => n.textContent)), [[], [], ['archived']]);
      assert.strictEqual(s.children[s.children.length - 1], byClass(s, 'children-list')[0].parentNode, 'the children close the sheet');
      page.click(items[2].children[0]);
      assert.strictEqual(byClass(page.byId('modalscroll'), 'ttl')[0].textContent, 'Shipped');
    });
  });

  test('a card with no children lists none', () => {
    open(BOARD, (page) => assert.strictEqual(byClass(sheet(page, 4), 'children-list').length, 0));
  });

  test('an archived card\'s read-only sheet carries its thread as well', () => {
    open(BOARD, (page) => {
      page.run('statusVis.archive=true;colOpen["archive"]=true;render()');
      const s = sheet(page, 9);
      assert.deepStrictEqual(entries(s, 'thread-item'), ['fixture#1 Ship it', 'fixture#2 Build']);
    });
  });

  test('a board name with spaces still opens the thread\'s cards', () => {
    const spaced = { ...BOARD, config: BOARD.config.replace('name: fixture', 'name: My Board') };
    open(spaced, (page) => {
      const chip = byClass(sheet(page, 4), 'thread-item')[0].children[0];
      assert.strictEqual(chip.textContent, 'My Board#1 Ship it');
      page.click(chip);
      assert.strictEqual(byClass(page.byId('modalscroll'), 'ttl')[0].textContent, 'Ship it');
    });
  });
});
