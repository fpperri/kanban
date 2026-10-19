const { test } = require('node:test');
const assert = require('node:assert');
const { card, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// A board holding a plain id (#7), a group (#G3) and a note (#_12), the three kinds of
// id the snapshot reads, plus a card with no `id:` line whose file name holds the id.
const MIXED = {
  config: 'name: mixed\nstatuses: [backlog, todo, doing, done]\n',
  cards: {
    '0007.plain.card.md': card(7, 'todo', 'Plain seven'),
    'G0003.group.card.md': card('G3', 'todo', 'Group three'),
    '_0012.note.card.md': card('_12', 'backlog', 'Note twelve'),
    'G0004.only-a-name.card.md': '---\nstatus: backlog\n---\n\nbody\n',
  },
};

const open = (board, fn) => withSnapshot(board, (html, dir) => fn(loadPage(html), dir));

test('the builder reads every id as the whole id string, from the id line or the file name', () => {
  open(MIXED, (page) => {
    const byFile = Object.fromEntries(page.plain(page.run('DATA')).map((c) => [c.fn, c.id]));
    assert.deepStrictEqual(byFile, {
      '0007.plain.card.md': '7',
      'G0003.group.card.md': 'G3',
      '_0012.note.card.md': '_12',
      'G0004.only-a-name.card.md': 'G4',
    });
  });
});

test('a card with no id line takes its title from the file name without the id prefix', () => {
  open(MIXED, (page) => {
    const c = page.plain(page.run('DATA')).find((x) => x.fn === 'G0004.only-a-name.card.md');
    assert.strictEqual(c.t, 'only a name');
  });
});

test('waiting_for ids read as whole ids, a padded or prefixed one the same as the card it names', () => {
  const board = {
    config: MIXED.config,
    cards: {
      ...MIXED.cards,
      '0020.waits.card.md': card(20, 'todo', 'Waits', { waiting_for: '[G3, 0007, _12, nonsense]' }),
    },
  };
  open(board, (page) => {
    const waits = page.plain(page.run('DATA')).find((c) => c.id === '20');
    assert.deepStrictEqual(waits.w, ['G3', '7', '_12', 'nonsense']);
    assert.deepStrictEqual(page.plain(page.run('unresolved(DATA.find(c=>c.id==="20"))')), ['G3', '7', '_12']);
  });
});
