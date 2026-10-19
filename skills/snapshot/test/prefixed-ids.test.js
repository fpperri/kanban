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

const WIDE = { matchMedia: (q) => q.includes('min-width:900px') };
const open = (board, fn) => withSnapshot(board, (html, dir) => fn(loadPage(html, WIDE), dir));

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

test('the apply protocol says an op names the whole id, prefix included, and how the card file is found', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const protocol = fs.readFileSync(path.join(__dirname, '..', 'references', 'apply-protocol.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(protocol.includes('"id":"G3"'), 'a prefixed id is shown as the string it is');
  assert.match(protocol, /whole id/i);
  assert.match(protocol, /`#7` and `#G7` are two cards/);
  assert.match(protocol, /`id:` line/);
});

// Plain ids, a group and a note that wait on each other: 7 waits on G3, G3 on _12.
const LINKED = {
  config: 'name: linked\nstatuses: [backlog, todo, doing, done]\n',
  cards: {
    '0007.plain.card.md': card(7, 'todo', 'Plain seven', { waiting_for: '[G3]' }),
    'G0003.group.card.md': card('G3', 'todo', 'Group three', { waiting_for: '[_12]' }),
    '_0012.note.card.md': card('_12', 'backlog', 'Note twelve'),
    '0009.free.card.md': card(9, 'backlog', 'Free nine'),
  },
};

test('a column lists cards in id order, plain ids first, then by prefix, then by number, whatever the file names say', () => {
  const board = {
    config: MIXED.config,
    cards: {
      '0010.ten.card.md': card(10, 'todo', 'Ten'),
      '9.nine.card.md': card(9, 'todo', 'Nine'),
      'G3.g-three.card.md': card('G3', 'todo', 'G three'),
      'G10.g-ten.card.md': card('G10', 'todo', 'G ten'),
      '_2.n-two.card.md': card('_2', 'todo', 'N two'),
    },
  };
  open(board, (page) => {
    assert.deepStrictEqual(page.plain(page.run('DATA')).map((c) => c.id), ['9', '10', 'G3', 'G10', '_2']);
    const tiles = page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => n.dataset.card);
    assert.deepStrictEqual(tiles, ['9', '10', 'G3', 'G10', '_2']);
  });
});

test('a tile shows the whole id', () => {
  open(LINKED, (page) => {
    const tile = page.byId('board').all().find((n) => n.classList.contains('card') && n.dataset.card === 'G3');
    assert.ok(tile.textContent.includes('#G3'));
  });
});

test('dependencies link the right cards, and the tree and path of one card reach the others', () => {
  open(LINKED, (page) => {
    const edges = page.plain(page.run('buildDepGraph(DATA).edges')).filter((e) => e.kind === 'dep');
    assert.deepStrictEqual(edges.map((e) => `${e.from}>${e.to}`).sort(), ['G3>7', '_12>G3']);
    assert.deepStrictEqual([...page.plain(page.run('[...treeIds("G3")]'))].sort(), ['7', 'G3', '_12']);
    assert.deepStrictEqual([...page.plain(page.run('[...pathIds("_12")]'))].sort(), ['7', 'G3', '_12']);
    assert.deepStrictEqual([...page.plain(page.run('[...treeIds("0007")]'))].sort(), ['7', 'G3', '_12']);
    assert.deepStrictEqual([...page.plain(page.run('[...treeIds("9")]'))], ['9']);
    assert.deepStrictEqual([...page.plain(page.run('[...treeIds("G9")]'))], []);
  });
});

test('the map layers prefixed ids by their dependencies and breaks a loop at the lowest id', () => {
  open(LINKED, (page) => {
    const layers = page.plain(page.run(`(() => { const m = layerNodes(["7","G3","_12"], buildDepGraph(DATA).edges.filter(e => e.kind === "dep")); return Object.fromEntries(m) })()`));
    assert.deepStrictEqual(layers, { _12: 0, G3: 1, 7: 2 });
    const loop = page.plain(page.run(`Object.fromEntries(layerNodes(["_12","G3","7"], [{from:"7",to:"G3"},{from:"G3",to:"_12"},{from:"_12",to:"7"}]))`));
    assert.deepStrictEqual(loop, { 7: 0, G3: 1, _12: 2 });
  });
});

test('the map draws the prefixed cards as nodes, each under its whole id, in id order within a row', () => {
  open(LINKED, (page) => {
    const g = page.plain(page.run('(() => { const s = mapShape(new Set(DATA.map(c => c.id))); return { ids: s.graphs.map(x => x.ids), none: s.noRelations } })()'));
    assert.deepStrictEqual(g.none, ['9']);
    assert.deepStrictEqual(g.ids.map((x) => x.slice().sort()), [['7', 'G3', '_12']]);
  });
});

test('a parent on another board is a stub whose id cannot be a card id', () => {
  const board = {
    config: LINKED.config,
    cards: { ...LINKED.cards, '0010.elsewhere.card.md': card(10, 'todo', 'Elsewhere', { parent: '"fpp#4"' }) },
  };
  open(board, (page) => {
    const rel = page.plain(page.run('buildRelGraph(new Set(DATA.map(c => c.id)))'));
    const stub = rel.ghosts.find((n) => n.external);
    assert.ok(stub, 'the stub is there');
    assert.ok(!page.run(`kanbanIds.parseId(${JSON.stringify(stub.id)})`), 'and its id is not an id');
    assert.deepStrictEqual(rel.pairs.filter((p) => p.child === '10').map((p) => p.parent), [stub.id]);
  });
});

test('a gantt row group lists dated cards in id order', () => {
  const dated = { start_date: '2026-10-01', end_date: '2026-10-05' };
  const board = {
    config: LINKED.config,
    cards: {
      '_0012.note.card.md': card('_12', 'todo', 'Note', dated),
      'G0003.group.card.md': card('G3', 'todo', 'Group', dated),
      '0007.plain.card.md': card(7, 'todo', 'Plain', dated),
    },
  };
  open(board, (page) => {
    const rows = page.plain(page.run('ganttData().groups.map(g => g.rows.map(r => r.c.id))'));
    assert.deepStrictEqual(rows, [['7', 'G3', '_12']]);
  });
});

test('a queued change names the whole id in the payload, and a queued new card never collides with a real id', () => {
  open(LINKED, (page) => {
    page.run('queue({op:"move",id:"G3",to:"done"});queue({op:"edit",id:"_12",title:"Renamed"});queue({op:"create",title:"Fresh",status:"todo"})');
    const ops = JSON.parse(page.run('payload()').split('\n')[1]);
    assert.deepStrictEqual(ops.slice(0, 2), [{ op: 'move', id: 'G3', to: 'done' }, { op: 'edit', id: '_12', title: 'Renamed' }]);
    const ids = page.plain(page.run('searchUniverse().map(c => c.id)'));
    assert.strictEqual(new Set(ids).size, ids.length);
    const queued = ids.filter((i) => !page.plain(page.run('DATA.map(c => c.id)')).includes(i));
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(page.run(`kanbanIds.parseId(${JSON.stringify(queued[0])})`), null);
  });
});

// The search is the web's own module, embedded: it reads these ids as the id module does.
const shown = (page) => page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => n.dataset.card).sort();
const search = (board, text) => open(board, (page) => { page.type(page.byId('q'), text); return shown(page); });

test('the search finds plain, group and note ids by #id and board#id', () => {
  assert.deepStrictEqual(search(LINKED, '#7'), ['7']);
  assert.deepStrictEqual(search(LINKED, '#G3'), ['G3']);
  assert.deepStrictEqual(search(LINKED, '#_12'), ['_12']);
  assert.deepStrictEqual(search(LINKED, 'linked#G3'), ['G3']);
  assert.deepStrictEqual(search(LINKED, '#G7'), []);
});

test('tree:, path: and waiting: follow prefixed ids', () => {
  assert.deepStrictEqual(search(LINKED, 'tree:G3'), ['7', 'G3', '_12']);
  assert.deepStrictEqual(search(LINKED, 'path:#_12'), ['7', 'G3', '_12']);
  assert.deepStrictEqual(search(LINKED, 'waiting:'), ['7', 'G3']);
});
