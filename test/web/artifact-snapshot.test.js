const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPage } = require('../../plugin/skills/web/scripts/artifact-build');
const { boot } = require('../../plugin/skills/web/scripts/page-source');

// A Snapshot query picks the cards the built page carries, in the Web's own search words: by default the
// live cards only, with the archive when asked. A card the query leaves out carries nothing; a group
// that lists it still lists its id. Bodies travel whole and once, and a page over 16 MB is refused.

const SCRIPT = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'artifact-build.js');
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="kanban-board">([\s\S]*?)<\/script>/)[1]);
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
};

function tmpTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-'));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  return root;
}

const card = (id, title, { tags = [], body = `body of ${id}` } = {}) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: [${tags.join(', ')}]\n---\n\n# ${title}\n\n${body}\n`;

const load = async (html) => (await boot(dataOf(html), { storage: memoryStorage(), device: 'd' }).request('GET', '/api/board')).json;
const idsOf = (list) => list.map((c) => c.id).sort();

function tagged() {
  return tmpTree({
    'p/.kanban/config.yaml': 'name: tagged\nnextId: 9\n',
    'p/.kanban/0001.one.card.md': card(1, 'One', { tags: ['ui'] }),
    'p/.kanban/0002.two.card.md': card(2, 'Two', { tags: ['api'] }),
    'p/.kanban/archived/0003.three.card.md': card(3, 'Three', { tags: ['ui'] }),
    'p/.kanban/archived/0004.four.card.md': card(4, 'Four', { tags: ['api'] }),
  });
}

test('a default build carries the live cards and no archived card', async () => {
  const root = tagged();
  try {
    const { html } = buildPage({ boardDir: path.join(root, 'p', '.kanban') });
    const board = await load(html);
    assert.deepStrictEqual(idsOf(board.active), ['1', '2']);
    assert.deepStrictEqual(board.archived, []);
    assert.ok(!Object.keys(dataOf(html).files).some((f) => /\/archived\//.test(f)), 'no archived file is in the page');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a build with the archive carries the archived cards too', async () => {
  const root = tagged();
  try {
    const board = await load(buildPage({ boardDir: path.join(root, 'p', '.kanban'), archive: true }).html);
    assert.deepStrictEqual(idsOf(board.active), ['1', '2']);
    assert.deepStrictEqual(idsOf(board.archived), ['3', '4']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a build with a tag query carries only that tag\'s cards, with the archive only when asked', async () => {
  const root = tagged();
  try {
    const dir = path.join(root, 'p', '.kanban');
    const live = await load(buildPage({ boardDir: dir, query: 'tags:ui' }).html);
    assert.deepStrictEqual(idsOf(live.active), ['1']);
    assert.deepStrictEqual(live.archived, []);
    const both = await load(buildPage({ boardDir: dir, query: 'tags:ui', archive: true }).html);
    assert.deepStrictEqual(idsOf(both.active), ['1']);
    assert.deepStrictEqual(idsOf(both.archived), ['3']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the query is read by the Web\'s own search module: an or, a card id and a graph term all pick', async () => {
  const root = tmpTree({
    'p/.kanban/config.yaml': 'name: graphy\nnextId: 9\n',
    'p/.kanban/0001.one.card.md': card(1, 'One'),
    'p/.kanban/0002.two.card.md': card(2, 'Two').replace('tags: []', 'tags: []\nwaiting_for: [1]'),
    'p/.kanban/0003.three.card.md': card(3, 'Three'),
    'p/.kanban/archived/0004.four.card.md': card(4, 'Four').replace('tags: []', 'tags: []\nwaiting_for: [2]'),
  });
  try {
    const dir = path.join(root, 'p', '.kanban');
    assert.deepStrictEqual(idsOf((await load(buildPage({ boardDir: dir, query: '#1 | #3' }).html)).active), ['1', '3']);
    assert.deepStrictEqual(idsOf((await load(buildPage({ boardDir: dir, query: 'tree:1' }).html)).active), ['1', '2']);
    const walked = await load(buildPage({ boardDir: dir, query: 'tree:1', archive: true }).html);
    assert.deepStrictEqual(idsOf(walked.archived), ['4'], 'the graph walks the archive whether or not it is carried');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the board names its query for the header', () => {
  const root = tagged();
  try {
    const dir = path.join(root, 'p', '.kanban');
    assert.deepStrictEqual(buildPage({ boardDir: dir }).board.snapshot, { query: '', archive: false, label: 'live cards only' });
    assert.deepStrictEqual(buildPage({ boardDir: dir, archive: true }).board.snapshot, { query: '', archive: true, label: 'with the archive' });
    assert.deepStrictEqual(buildPage({ boardDir: dir, query: '  tags:ui ' }).board.snapshot, { query: 'tags:ui', archive: false, label: 'tags:ui · live cards only' });
    assert.strictEqual(buildPage({ boardDir: dir, query: 'tags:ui', archive: true }).board.snapshot.label, 'tags:ui · with the archive');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the board load of the page says the query it was built with', async () => {
  const root = tagged();
  try {
    const board = await load(buildPage({ boardDir: path.join(root, 'p', '.kanban'), query: 'tags:api' }).html);
    assert.deepStrictEqual(board.snapshot, { query: 'tags:api', archive: false, label: 'tags:api · live cards only' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a body of 10,000 characters arrives whole in the page, and the page holds it once', async () => {
  const body = Array.from({ length: 500 }, (_, i) => `line ${String(i).padStart(3, '0')} of the long body.`).join('\n').slice(0, 10000);
  assert.strictEqual(body.length, 10000);
  const root = tmpTree({ 'p/.kanban/config.yaml': 'name: long\nnextId: 4\n', 'p/.kanban/0001.one.card.md': card(1, 'One', { body }), 'p/.kanban/archived/0002.old.card.md': card(2, 'Old', { body }) });
  try {
    const dir = path.join(root, 'p', '.kanban');
    const { html } = buildPage({ boardDir: dir });
    const src = boot(dataOf(html), { storage: memoryStorage(), device: 'd' });
    const board = (await src.request('GET', '/api/board')).json;
    assert.strictEqual(board.active[0].body.trim(), body.trim());
    assert.strictEqual((await src.request('GET', '/api/cards/1/detail')).json.body.includes(body), true);
    const needle = JSON.stringify(body.slice(4000, 4400)).slice(1, -1);
    assert.strictEqual(html.split(needle).length - 1, 1, 'the body is in the page once');
    const withArchive = buildPage({ boardDir: dir, archive: true }).html;
    assert.strictEqual(withArchive.split(needle).length - 1, 2, 'one body per card carried, never two');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a group still lists a member the query leaves out, as an id with no card behind it', async () => {
  const root = tmpTree({
    'p/.kanban/config.yaml': 'name: grouped\nnextId: 9\ngroups: .groups\n',
    'p/.kanban/0001.one.card.md': card(1, 'One'),
    'p/.kanban/0002.two.card.md': card(2, 'Two', { body: 'SECRET-BODY-OF-TWO' }),
    'p/.kanban/.groups/_0001.pair.md': '---\nid: _1\nname: pair\ncards: [1, 2]\n---\n',
  });
  try {
    const { html } = buildPage({ boardDir: path.join(root, 'p', '.kanban'), query: '#1' });
    const board = await load(html);
    assert.deepStrictEqual(idsOf(board.active), ['1']);
    assert.deepStrictEqual(board.groups.list.map((g) => g.cards), [['1', '2']]);
    assert.ok(!html.includes('SECRET-BODY-OF-TWO'), 'the left-out card carries no content');
    assert.ok(!Object.keys(dataOf(html).files).some((f) => f.includes('0002.two')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the scratchpad, folder and todo list of a card the query leaves out stay out; a group\'s and a kept card\'s come along', () => {
  const root = tmpTree({
    'p/.kanban/config.yaml': 'name: padded\nnextId: 9\ngroups: .groups\nscratchpad: ../pads/<card>\ntodos: ../todos\n',
    'p/.kanban/0001.one.card.md': card(1, 'One'),
    'p/.kanban/0002.two.card.md': card(2, 'Two'),
    'p/.kanban/.groups/_0003.trio.md': '---\nid: _3\nname: trio\ncards: [1, 2]\n---\n',
    'p/pads/0001.one/0001.scratchpad.md': 'page one\n',
    'p/pads/0001.one/notes.md': 'notes one\n',
    'p/pads/0002.two/0002.scratchpad.md': 'page two\n',
    'p/pads/0002.two/notes.md': 'notes two\n',
    'p/pads/0003.trio/0003.scratchpad.md': 'page of the group\n',
    'p/todos/0001.todo.md': '- [ ] one\n',
    'p/todos/0002.todo.md': '- [ ] two\n',
  });
  try {
    const { html } = buildPage({ boardDir: path.join(root, 'p', '.kanban'), query: '#1' });
    const names = Object.keys(dataOf(html).files).map((f) => f.replace(/^.*\/p\//, ''));
    for (const kept of ['pads/0001.one/0001.scratchpad.md', 'pads/0001.one/notes.md', 'pads/0003.trio/0003.scratchpad.md', 'todos/0001.todo.md', '.kanban/.groups/_0003.trio.md']) assert.ok(names.includes(kept), `${kept} comes along: ${names.join(', ')}`);
    for (const left of ['pads/0002.two/0002.scratchpad.md', 'pads/0002.two/notes.md', 'todos/0002.todo.md', '.kanban/0002.two.card.md']) assert.ok(!names.includes(left), `${left} stays out`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function bigBoard(cards, megabytes) {
  const files = { 'p/.kanban/config.yaml': `name: big\nnextId: ${cards + 2}\n` };
  const filler = 'x'.repeat(megabytes * 1024 * 1024);
  for (let i = 1; i <= cards; i += 1) files[`p/.kanban/${String(i).padStart(4, '0')}.c${i}.card.md`] = card(i, `Card ${i}`, { body: filler });
  return tmpTree(files);
}

test('a build over 16 MB is refused with the size and a suggestion, and writes no file', () => {
  const root = bigBoard(17, 1);
  const out = path.join(root, 'out', 'board.html');
  try {
    const dir = path.join(root, 'p', '.kanban');
    assert.throws(() => buildPage({ boardDir: dir }), (e) => /\d+\.\d MB/.test(e.message) && /over the 16 MB limit/.test(e.message) && /narrower query/.test(e.message));
    const ran = spawnSync(process.execPath, [SCRIPT, dir, '--out', out], { encoding: 'utf8' });
    assert.strictEqual(ran.status, 2);
    assert.match(ran.stderr, /\d+\.\d MB/);
    assert.match(ran.stderr, /narrower query/);
    assert.ok(!fs.existsSync(out), 'no file is written');
    assert.ok(!fs.existsSync(path.dirname(out)), 'not even its folder');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a narrower query brings a board over 16 MB under it, because a card left out carries nothing', () => {
  const root = bigBoard(17, 1);
  try {
    const dir = path.join(root, 'p', '.kanban');
    assert.throws(() => buildPage({ boardDir: dir }), /16 MB/);
    const { bytes } = buildPage({ boardDir: dir, query: '#1 | #2 | #3' });
    assert.ok(bytes < 16 * 1024 * 1024 && bytes > 3 * 1024 * 1024, String(bytes));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the command takes --query and --archive', () => {
  const root = tagged();
  const out = path.join(root, 'board.html');
  try {
    const dir = path.join(root, 'p', '.kanban');
    const ran = spawnSync(process.execPath, [SCRIPT, dir, '--out', out, '--query', 'tags:ui', '--archive'], { encoding: 'utf8' });
    assert.strictEqual(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /tags:ui/);
    const board = dataOf(fs.readFileSync(out, 'utf8')).board;
    assert.deepStrictEqual(board.snapshot, { query: 'tags:ui', archive: true, label: 'tags:ui · with the archive' });
    assert.strictEqual(spawnSync(process.execPath, [SCRIPT, dir, '--out', out, '--query'], { encoding: 'utf8' }).status, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
