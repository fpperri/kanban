const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cardStore = require('../../web/scripts/card-store');
const { BOARD, card } = require('./nesting-fixture');
const { byClass } = require('./page-harness');
const { open, sheet } = require('./nesting-view');

// A card's type and parent change through the tray like any other field, as raw
// frontmatter assignments in an edit op. Rank is not offered anywhere.

const modal = (page) => page.byId('modalscroll');
const control = (page, pred) => modal(page).all().find(pred);

function ops(page) {
  const text = page.run('payload()');
  return JSON.parse(text.slice(text.indexOf('\n') + 1));
}

// What a person does: open All fields, type into the field, tap its Save.
function saveField(page, key, value) {
  if (!control(page, (n) => n.id === `fm-${key}`)) page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
  control(page, (n) => n.id === `fm-${key}`).value = value;
  page.click(control(page, (n) => n.dataset.act === 'fmsave' && n.dataset.key === key));
}

// The apply protocol's edit.fm rule: set the key, quote a value holding ":" or
// "#", and let "" remove it.
function applyFm(text, fm) {
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  let head = lines.slice(1, end);
  for (const [k, v] of Object.entries(fm)) {
    head = head.filter((l) => !l.startsWith(`${k}:`));
    if (v !== '') head.push(`${k}: ${/[:#]/.test(v) ? JSON.stringify(v) : v}`);
  }
  return ['---', ...head, ...lines.slice(end)].join('\n');
}

// Applies the edit to the card's file and reads it back with kanban-web's own reader.
function readBack(fileName, fm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-apply-'));
  try {
    const file = path.join(dir, fileName);
    fs.writeFileSync(file, applyFm(BOARD.cards[fileName], fm));
    return cardStore.readCardFile(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the All fields grid offers type and parent on a card that has neither', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.ok(control(page, (n) => n.id === 'fm-type'));
    assert.ok(control(page, (n) => n.id === 'fm-parent'));
  });
});

test('a type and a parent saved for a card queue one edit that applies cleanly', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    saveField(page, 'type', 'story');
    saveField(page, 'parent', '2');
    assert.deepStrictEqual(ops(page), [{ op: 'edit', id: '8', fm: { type: 'story', parent: '2' } }]);
    const read = readBack('0008.loose.card.md', ops(page)[0].fm);
    assert.strictEqual(read.type, 'story');
    assert.strictEqual(read.parent, 2);
    assert.strictEqual(read.title, 'Loose');
  });
});

test('a parent on another board travels as board#id and kanban-web reads it back', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    saveField(page, 'parent', 'fpp#4');
    const { fm } = ops(page)[0];
    assert.deepStrictEqual(fm, { parent: 'fpp#4' });
    assert.strictEqual(readBack('0008.loose.card.md', fm).parent, 'fpp#4');
  });
});

test('blanking both fields removes them from the card', () => {
  open(BOARD, (page) => {
    sheet(page, 4);
    saveField(page, 'type', '');
    saveField(page, 'parent', '');
    const { fm } = ops(page)[0];
    assert.deepStrictEqual(fm, { type: '', parent: '' });
    const read = readBack('0004.write-code.card.md', fm);
    assert.strictEqual(read.type, null);
    assert.strictEqual(read.parent, null);
  });
});

test('the type pill offers the declared types, the current one and none, and the choice queues a type edit', () => {
  const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd', { type: 'saga' }) } };
  open(board, (page) => {
    sheet(page, 12);
    const pill = control(page, (n) => n.dataset.pill === 'type');
    assert.strictEqual(pill.textContent, 'saga');
    page.click(pill);
    const select = control(page, (n) => n.dataset.act === 'typ');
    assert.deepStrictEqual(select.children.map((o) => o.value), ['', 'objective', 'epic', 'story', 'saga']);
    assert.strictEqual(select.children[0].textContent, 'no type');
    select.value = 'epic';
    page.change(select);
    assert.deepStrictEqual(ops(page), [{ op: 'edit', id: '12', fm: { type: 'epic' } }]);
    assert.strictEqual(control(page, (n) => n.dataset.pill === 'type').textContent, 'epic');
  });
});

test('choosing no type queues the blank that removes it', () => {
  open(BOARD, (page) => {
    sheet(page, 4);
    page.click(control(page, (n) => n.dataset.pill === 'type'));
    const select = control(page, (n) => n.dataset.act === 'typ');
    select.value = '';
    page.change(select);
    assert.deepStrictEqual(ops(page), [{ op: 'edit', id: '4', fm: { type: '' } }]);
    assert.strictEqual(control(page, (n) => n.dataset.pill === 'type').textContent, 'no type');
  });
});

test('a card created in the tray has no type pill, since its create carries no type', () => {
  open(BOARD, (page) => {
    page.run('queue({op:"create",title:"Fresh",status:"todo"});render()');
    sheet(page, 'n1');
    assert.ok(!control(page, (n) => n.dataset.pill === 'type'), 'no type pill');
    assert.ok(control(page, (n) => n.dataset.pill === 'priority'), 'the sheet itself is open');
  });
});

test('an archived card\'s read-only sheet has no type pill', () => {
  open(BOARD, (page) => {
    page.run('statusVis.archive=true;colOpen["archive"]=true;render()');
    sheet(page, 9);
    assert.strictEqual(control(page, (n) => n.dataset.pill === 'type'), undefined);
  });
});

test('a queued change shows at once in the chip, the thread and the parent\'s roll-up', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    saveField(page, 'type', 'story');
    saveField(page, 'parent', '2');
    assert.deepStrictEqual(byClass(modal(page), 'type-chip').map((n) => n.textContent), ['story']);
    assert.deepStrictEqual(byClass(modal(page), 'thread-item').map((n) => n.textContent), ['fixture#1 Ship it', 'fixture#2 Build']);
    page.click(byClass(modal(page), 'thread-item')[1].children[0]);
    assert.strictEqual(byClass(modal(page), 'rollup-total')[0].textContent, '4', 'the loose card is now a leaf under Build');
    assert.ok(byClass(modal(page), 'child-item').some((n) => n.textContent === 'fixture#8 Loose'));
  });
});

test('the map keeps reading a parent edited in the tray', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    saveField(page, 'parent', '2');
    assert.strictEqual(page.run('find("8").pt'), 2);
    saveField(page, 'parent', 'fpp#4');
    assert.strictEqual(page.run('find("8").pt'), null);
    saveField(page, 'parent', '');
    assert.strictEqual(page.run('find("8").pt'), null);
  });
});

test('no control changes rank, even on a card that has one', () => {
  open(BOARD, (page) => {
    sheet(page, 4);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.ok(control(page, (n) => n.id === 'fm-type'), 'the grid is open');
    const rankish = (root) => root.all()
      .filter((n) => /rank/i.test([n.id, n.dataset.key, n.dataset.act, n.dataset.pill, n.title].join(' ')))
      .map((n) => `${n.tagName} ${n.id || n.dataset.key}`);
    assert.deepStrictEqual(rankish(modal(page)), []);
    assert.deepStrictEqual(rankish(page.byId('board')), []);
    page.click(page.byId('newbtn'));
    assert.deepStrictEqual(rankish(modal(page)), []);
  });
});

test('editing a ranked card never sends its rank along', () => {
  open(BOARD, (page) => {
    sheet(page, 4);
    saveField(page, 'type', 'task');
    assert.deepStrictEqual(ops(page), [{ op: 'edit', id: '4', fm: { type: 'task' } }]);
  });
});

test('taking a queued type and parent change back out leaves the card as it was', () => {
  open(BOARD, (page) => {
    sheet(page, 8);
    saveField(page, 'type', 'story');
    saveField(page, 'parent', '2');
    page.click(page.byId('pend').all().find((n) => n.dataset.rm === '0'));
    assert.deepStrictEqual(ops(page), []);
    assert.deepStrictEqual(byClass(modal(page), 'type-chip'), []);
    assert.deepStrictEqual(byClass(modal(page), 'thread-item'), []);
    assert.strictEqual(page.run('find("8").pt'), null);
  });
});
