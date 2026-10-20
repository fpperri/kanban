const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

// Groups (docs/adr/0015) through the server's HTTP API on a temporary board: the files a
// person writes by hand are read, and a group made, changed or given members through the
// routes lands in the right file with the right id.

const CONFIG = [
  'name: t',
  'nextId: 30',
  'groups: .groups',
  'logbook: logbook',
  'prefixes:',
  '  _: .groups',
  '  I: .groups/iteration',
  '  W: workflow/',
  '  DW: workflow/dynamic',
  '  G: goal',
  'counters: { I: 3 }',
  '',
].join('\n');

const card = (id, title, type) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n${type ? `type: ${type}\n` : ''}---\n\n# ${title}\n`;

function tmpBoard({ config = CONFIG, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-groups-srv-'));
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3, 'Three'));
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), card(7, 'Seven'));
  fs.writeFileSync(path.join(dir, '0015.fifteen.card.md'), card(15, 'Fifteen'));
  fs.mkdirSync(path.join(dir, 'archived'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'archived', '0002.two.card.md'), card(2, 'Two'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function req(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const board = async (base) => (await req(base, 'GET', '/api/board')).json;
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const tree = (dir, rel = '.groups') => {
  const out = [];
  const walk = (r) => {
    for (const e of fs.readdirSync(path.join(dir, r), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${r}/${e.name}`); else out.push(`${r}/${e.name}`);
    }
  };
  if (fs.existsSync(path.join(dir, rel))) walk(rel);
  return out.sort();
};

const I2 = '---\nid: I2\nname: zephyr-2\nstart_date: 2026-10-12\nend_date: 2026-10-23\nauto_join: true\nowner: "@human"\ncards: [3, 7]\n---\n\nThe second iteration.\n';
const W1 = '---\nid: W1\nname: orders-cutover\ncards: [7, 15, 99, 2]\n---\n';
const LOOSE = '---\nid: _1\nname: offsite-prep\ncards: [3]\n---\n';
const DEEP = '---\nid: DW1\nname: schema-diff-review\ncards: [7]\n---\n';

test('with no groups: line the payload carries no groups and every group route is a 404', async () => {
  const dir = tmpBoard({ config: 'name: t\n' });
  await withServer(dir, async (base) => {
    assert.strictEqual((await board(base)).groups, null);
    assert.strictEqual((await req(base, 'POST', '/api/groups', { name: 'x' })).status, 404);
    assert.strictEqual((await req(base, 'PATCH', '/api/groups/I1', { name: 'x' })).status, 404);
    assert.strictEqual((await req(base, 'POST', '/api/groups/I1/members', { add: ['3'] })).status, 404);
  });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.groups')), []);
});

test('the payload says whether iterations are on: only with iterations: true and a groups: line', async () => {
  const on = tmpBoard({ config: CONFIG + 'iterations: true\n' });
  await withServer(on, async (base) => assert.strictEqual((await board(base)).iterations, true));
  await withServer(tmpBoard(), async (base) => assert.strictEqual((await board(base)).iterations, false));
  const noGroups = tmpBoard({ config: 'name: t\niterations: true\n' });
  await withServer(noGroups, async (base) => assert.strictEqual((await board(base)).iterations, false, 'iterations are groups: no groups, no dropdown'));
});

test('with a groups: line and no folder yet the payload carries an empty groups', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const g = (await board(base)).groups;
    assert.strictEqual(g.folder, '.groups');
    assert.deepStrictEqual(g.list, []);
    assert.deepStrictEqual(g.skipped, []);
  });
});

test('group files in the root, one folder and two folders are read; the folders are the type and subtype', async () => {
  const dir = tmpBoard({ files: {
    '.groups/_0001.offsite-prep.md': LOOSE,
    '.groups/iteration/I0002.zephyr-2.md': I2,
    '.groups/workflow/W0001.orders-cutover.md': W1,
    '.groups/workflow/dynamic/DW0001.schema-diff-review.md': DEEP,
  } });
  await withServer(dir, async (base) => {
    const list = (await board(base)).groups.list;
    const by = Object.fromEntries(list.map((g) => [g.id, g]));
    assert.deepStrictEqual(Object.keys(by).sort(), ['DW1', 'I2', 'W1', '_1']);
    assert.strictEqual(by._1.folder, '');
    assert.strictEqual(by.I2.folder, 'iteration');
    assert.strictEqual(by.DW1.folder, 'workflow/dynamic');
    assert.deepStrictEqual(by.I2, {
      id: 'I2', name: 'zephyr-2', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true,
      cards: ['3', '7'], extra: { owner: '@human' }, extra_raw: {}, file: '.groups/iteration/I0002.zephyr-2.md',
    });
    assert.deepStrictEqual(by.W1.cards, ['7', '15', '99', '2'], 'a member that is no card of the board is kept as written');
    assert.deepStrictEqual(by._1, { id: '_1', name: 'offsite-prep', folder: '', start_date: '', end_date: '', auto_join: false, cards: ['3'], extra: {}, extra_raw: {}, file: '.groups/_0001.offsite-prep.md' });
  });
});

test('a file nested deeper than two folders is skipped and reported, and the other groups still read', async () => {
  const dir = tmpBoard({ files: {
    '.groups/iteration/I0002.zephyr-2.md': I2,
    '.groups/a/b/c/X0001.too-deep.md': '---\nid: X1\nname: too-deep\ncards: []\n---\n',
    '.groups/a/b/c/d/Y0001.deeper.md': '---\nid: Y1\nname: deeper\ncards: []\n---\n',
  } });
  await withServer(dir, async (base) => {
    const g = (await board(base)).groups;
    assert.deepStrictEqual(g.list.map((x) => x.id), ['I2']);
    assert.strictEqual(g.skipped.length, 2);
    assert.deepStrictEqual(g.skipped.map((s) => s.file).sort(), ['.groups/a/b/c/X0001.too-deep.md', '.groups/a/b/c/d/Y0001.deeper.md']);
    assert.ok(g.skipped.every((s) => /two folders/.test(s.reason)), g.skipped[0].reason);
  });
});

test('a file with no id, an id that is no id, or a repeated id is skipped and reported, never fatal', async () => {
  const dir = tmpBoard({ files: {
    '.groups/I0002.one.md': I2,
    '.groups/noid.md': '---\nname: no id here\ncards: [3]\n---\n',
    '.groups/badid.md': '---\nid: g-7\nname: bad\ncards: []\n---\n',
    '.groups/dup.md': '---\nid: I2\nname: again\ncards: []\n---\n',
    '.groups/plain.md': 'just text, no frontmatter\n',
    '.groups/I0009.tmp-leftover.md.tmp': 'ignored',
  } });
  await withServer(dir, async (base) => {
    const g = (await board(base)).groups;
    assert.deepStrictEqual(g.list.map((x) => `${x.id}:${x.name}`), ['I2:zephyr-2']);
    assert.deepStrictEqual(g.skipped.map((s) => s.file).sort(), ['.groups/badid.md', '.groups/dup.md', '.groups/noid.md', '.groups/plain.md']);
  });
});

test('a group is found by its id, not by its file name', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/whatever-label.md': I2 } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'PATCH', '/api/groups/I2', { name: 'zephyr-2b' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.group.name, 'zephyr-2b');
  });
  assert.match(read(dir, '.groups/iteration/whatever-label.md'), /^name: zephyr-2b$/m);
});

test('a group made in a folder takes that folder\'s prefix and its counter, and lands in <padded id>.<slug>.md under it', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2 } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/groups', { name: 'zephyr 3', folder: 'iteration', start_date: '2026-10-26', end_date: '2026-11-06', auto_join: true, cards: ['3', '7'] });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.group.id, 'I3', 'the counter says 3, the highest file is I2');
    assert.strictEqual(r.json.group.file, '.groups/iteration/I0003.zephyr-3.md');
    assert.deepStrictEqual(r.json.group.cards, ['3', '7']);
    const again = await req(base, 'POST', '/api/groups', { name: 'zephyr-4', folder: 'iteration' });
    assert.strictEqual(again.json.group.id, 'I4');
    assert.strictEqual(again.json.group.auto_join, false);
  });
  assert.strictEqual(read(dir, '.groups/iteration/I0003.zephyr-3.md'), '---\nid: I3\nname: zephyr 3\nstart_date: 2026-10-26\nend_date: 2026-11-06\nauto_join: true\ncards: [3, 7]\n---\n');
  assert.match(read(dir, 'config.yaml'), /^counters: \{ I: 5 \}$/m);
});

test('a counter that lags the files heals to the highest id plus one', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0009.nine.md': '---\nid: I9\nname: nine\ncards: []\n---\n' } });
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/groups', { name: 'ten', folder: 'iteration' })).json.group.id, 'I10');
  });
});

test('a group with no folder takes the prefix naming the groups folder, or _ when none does', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/groups', { name: 'offsite-prep', cards: ['3'] });
    assert.strictEqual(r.json.group.id, '_1');
    assert.strictEqual(r.json.group.folder, '');
    assert.strictEqual(r.json.group.file, '.groups/_0001.offsite-prep.md');
    const nested = await req(base, 'POST', '/api/groups', { name: 'schema', folder: 'workflow/dynamic' });
    assert.strictEqual(nested.json.group.id, 'DW1', 'the exact folder, not its parent');
    assert.strictEqual(nested.json.group.file, '.groups/workflow/dynamic/DW0001.schema.md');
    const other = await req(base, 'POST', '/api/groups', { name: 'rest', folder: 'misc' });
    assert.strictEqual(other.json.group.id, '_2', 'a folder no prefix names takes _');
  });
  const none = tmpBoard({ config: 'name: t\ngroups: g\n' });
  await withServer(none, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/groups', { name: 'x', folder: 'iteration' })).json.group.id, '_1');
  });
  assert.deepStrictEqual(tree(none, 'g'), ['g/iteration/_0001.x.md']);
});

test('the id is padded to the board\'s idDigits', async () => {
  const dir = tmpBoard({ config: `${CONFIG}idDigits: 6\n` });
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/groups', { name: 'wide', folder: 'iteration' })).json.group.file, '.groups/iteration/I000003.wide.md');
  });
});

test('a bad group is a 400 and writes nothing', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const body of [
      { name: '' },
      { name: '   ' },
      { folder: 'iteration' },
      { name: 'x', folder: '../escape' },
      { name: 'x', folder: 'a/b/c' },
      { name: 'x', folder: '/abs' },
      { name: 'x', folder: 'a\\b' },
      { name: 'x', start_date: '16/10/2026' },
      { name: 'x', start_date: '2026-10-20', end_date: '2026-10-19' },
      { name: 'x', cards: ['99'] },
      { name: 'x', cards: ['I1'] },
      { name: 'x', cards: 'three' },
    ]) {
      const r = await req(base, 'POST', '/api/groups', body);
      assert.strictEqual(r.status, 400, JSON.stringify(body));
      assert.ok(r.json.error);
    }
  });
  assert.deepStrictEqual(tree(dir), []);
  assert.strictEqual(read(dir, 'config.yaml'), CONFIG, 'a refused group burns no id');
});

test('auto_join is kept only with both dates', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/groups', { name: 'undated', folder: 'iteration', auto_join: true });
    assert.strictEqual(r.json.group.auto_join, false);
    const half = await req(base, 'POST', '/api/groups', { name: 'half', folder: 'iteration', start_date: '2026-10-12', auto_join: true });
    assert.strictEqual(half.json.group.auto_join, false);
  });
});

test('PATCH changes the name, the dates, auto_join and extra keys and keeps every other line and the body', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2.replace('cards: [3, 7]', 'cards: [3, 7]\n# a comment kept') } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'PATCH', '/api/groups/I2', { name: 'zephyr two', end_date: '2026-10-24', auto_join: false, extra: { owner: '@afk', sprint: 'x y' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.group.extra, { owner: '@afk', sprint: 'x y' });
    assert.strictEqual(r.json.group.end_date, '2026-10-24');
    assert.strictEqual(r.json.group.auto_join, false);
  });
  const text = read(dir, '.groups/iteration/I0002.zephyr-2.md');
  assert.match(text, /^name: zephyr two$/m);
  assert.match(text, /^end_date: 2026-10-24$/m);
  assert.doesNotMatch(text, /auto_join/);
  assert.match(text, /^owner: "@afk"$/m);
  assert.match(text, /^sprint: x y$/m);
  assert.match(text, /^# a comment kept$/m);
  assert.match(text, /^start_date: 2026-10-12$/m);
  assert.match(text, /^cards: \[3, 7\]$/m);
  assert.ok(text.endsWith('---\n\nThe second iteration.\n'), text);
});

const SHAPED = '---\nid: I2\nname: zephyr-2\nowner: "@human"\ntags:\n  - a\n  - b\nnote: |\n  first line\n  second line\nmilestones: [a, b]\ncards: [3, 7]\n---\n\nBody.\n';

test('an extra key whose value is a list or several lines is reported as written, apart from the one-line extras', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': SHAPED } });
  await withServer(dir, async (base) => {
    const g = (await board(base)).groups.list.find((x) => x.id === 'I2');
    assert.deepStrictEqual(g.extra, { owner: '@human', milestones: '[a, b]' });
    assert.deepStrictEqual(g.extra_raw, { tags: 'tags:\n  - a\n  - b', note: 'note: |\n  first line\n  second line' });
  });
});

test('PATCH keeps a list or multi-line extra exactly as written, and refuses to overwrite or remove one', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': SHAPED } });
  await withServer(dir, async (base) => {
    const saved = await req(base, 'PATCH', '/api/groups/I2', { name: 'zephyr two', extra: { owner: '@afk' } });
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual(saved.json.group.extra_raw, { tags: 'tags:\n  - a\n  - b', note: 'note: |\n  first line\n  second line' });
    assert.strictEqual(read(dir, '.groups/iteration/I0002.zephyr-2.md'), SHAPED.replace('name: zephyr-2', 'name: zephyr two').replace('owner: "@human"', 'owner: "@afk"'));
    const before = read(dir, '.groups/iteration/I0002.zephyr-2.md');
    for (const extra of [{ tags: 'x' }, { note: null }, { tags: '' }]) {
      const r = await req(base, 'PATCH', '/api/groups/I2', { extra });
      assert.strictEqual(r.status, 409, JSON.stringify(extra));
      assert.match(r.json.error, /more than one line/);
    }
    assert.strictEqual(read(dir, '.groups/iteration/I0002.zephyr-2.md'), before);
  });
});

test('PATCH takes an extra key out with null, empties it with an empty string, clears a date with an empty string, and refuses a managed key as extra', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2 } });
  await withServer(dir, async (base) => {
    const emptied = await req(base, 'PATCH', '/api/groups/I2', { extra: { owner: '' } });
    assert.strictEqual(emptied.status, 200);
    assert.deepStrictEqual(emptied.json.group.extra, { owner: '' }, 'the key stays, its value is empty');
    assert.match(read(dir, '.groups/iteration/I0002.zephyr-2.md'), /^owner: ""$/m);
    const r = await req(base, 'PATCH', '/api/groups/I2', { start_date: '', end_date: '', extra: { owner: null } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.group.start_date, '');
    assert.strictEqual(r.json.group.auto_join, false, 'auto_join cannot outlive its dates');
    assert.deepStrictEqual(r.json.group.extra, {});
    for (const extra of [{ id: 'X9' }, { cards: '[1]' }, { 'bad key': 'x' }, { name: 'x' }]) {
      assert.strictEqual((await req(base, 'PATCH', '/api/groups/I2', { extra })).status, 400, JSON.stringify(extra));
    }
    assert.strictEqual((await req(base, 'PATCH', '/api/groups/I2', { name: '' })).status, 400);
    assert.strictEqual((await req(base, 'PATCH', '/api/groups/I77', { name: 'x' })).status, 404);
  });
  assert.doesNotMatch(read(dir, '.groups/iteration/I0002.zephyr-2.md'), /owner|auto_join|start_date|end_date/);
});

test('members are added and removed by id, once each, in id order, and only a card of the board can be added', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2 } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/groups/I2/members', { add: ['15', '3', '2'] });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.group.cards, ['2', '3', '7', '15'], 'an archived card is a card; 3 was already there');
    const rm = await req(base, 'POST', '/api/groups/I2/members', { remove: ['7', '99'] });
    assert.deepStrictEqual(rm.json.group.cards, ['2', '3', '15'], 'a member that is not there is nothing');
    for (const body of [{ add: ['99'] }, { add: ['I2'] }, { add: 'three' }, { add: ['../x'] }, {}]) {
      assert.strictEqual((await req(base, 'POST', '/api/groups/I2/members', body)).status, 400, JSON.stringify(body));
    }
    assert.strictEqual((await req(base, 'POST', '/api/groups/I9/members', { add: ['3'] })).status, 404);
    assert.deepStrictEqual((await board(base)).groups.list[0].cards, ['2', '3', '15']);
  });
  assert.match(read(dir, '.groups/iteration/I0002.zephyr-2.md'), /^cards: \[2, 3, 15\]$/m);
});

test('a group with no cards: line gets one when a member is added', async () => {
  const dir = tmpBoard({ files: { '.groups/loose.md': '---\nid: _4\nname: loose\n---\nbody\n' } });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'POST', '/api/groups/_4/members', { add: ['7'] })).json.group.cards, ['7']);
  });
  assert.strictEqual(read(dir, '.groups/loose.md'), '---\nid: _4\nname: loose\ncards: [7]\n---\nbody\n');
});

test('the group routes take a prefixed id and nothing else in the id slot', async () => {
  const dir = tmpBoard({ files: { '.groups/loose.md': '---\nid: _4\nname: loose\ncards: []\n---\n' } });
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'PATCH', '/api/groups/_4', { name: 'renamed' })).status, 200);
  });
});

test('a note on a group lands in <day>.<group id>.logbook.md', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2 } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: 'I2', at: '10:00', note: 'mid-iteration check' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.note.file, '2026.10.16.I0002.logbook.md');
    assert.strictEqual((await board(base)).logbook.notes[0].target, 'I2');
  });
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'logbook')), ['2026.10.16.I0002.logbook.md']);
});

test('a hand edit shows on the next read of the board', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/I0002.zephyr-2.md': I2 } });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await board(base)).groups.list[0].cards, ['3', '7']);
    fs.writeFileSync(path.join(dir, '.groups/iteration/I0002.zephyr-2.md'), I2.replace('[3, 7]', '[7]'));
    assert.deepStrictEqual((await board(base)).groups.list[0].cards, ['7']);
  });
});
