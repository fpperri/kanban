const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPage } = require('../../plugin/skills/web/scripts/artifact-build');
const { boot } = require('../../plugin/skills/web/scripts/page-source');

// The build makes one HTML file of the Web with the board inside: the page's files, route and the stores
// over shims, and the board folder's text files. These tests read the file it writes and boot the data it
// embeds in Node; test/web/browser/scenarios/artifact.js opens it in a browser.

const FIXTURE = path.join(__dirname, 'browser', 'fixture');
const SCRIPT = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'artifact-build.js');

const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="kanban-board">([\s\S]*?)<\/script>/)[1]);
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
};

function tmpTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-'));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  return root;
}

const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;

test('the file is one page: every script and the stylesheet inline, nothing fetched from a server', () => {
  const { html } = buildPage({ boardDir: FIXTURE });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/<(?:script|link)\b[^>]*\s(?:src|href)="\//.test(live), 'no root-relative reference is left');
  assert.ok(!/<link rel="stylesheet"/.test(live));
  assert.ok(/<style>[\s\S]+<\/style>/.test(live));
  for (const marker of ['async function loadBoard', 'const boardSourceModule', 'const pageSourceModule', 'const memoryFsModule', 'const moduleLoaderModule', 'const memoryRouteModule', 'const bufferShimModule', 'const artifactTrayModule']) assert.ok(html.includes(marker), marker);
});

test('the page source is set before app.js runs, and app.js is the last script', () => {
  const { html } = buildPage({ boardDir: FIXTURE });
  const at = (s) => html.indexOf(s);
  assert.ok(at('window.kanbanSourceInUse =') > -1);
  assert.ok(at('window.kanbanSourceInUse =') < at('async function loadBoard'));
  assert.ok(at('pageSourceModule') < at('window.kanbanSourceInUse ='));
  assert.ok(at('artifactTrayModule') < at('pageSourceModule'));
  assert.ok(html.includes('claude: window.claude'), 'the page source is given window.claude');
  assert.ok(at('async function loadBoard') > at('window.kanbanSourceInUse ='));
});

test('the embedded board boots into a page source that answers the board load and queues a save', async () => {
  const { html, board } = buildPage({ boardDir: FIXTURE, archive: true, now: () => new Date('2026-10-31T01:02:03.000Z') });
  assert.strictEqual(board.name, 'fixture');
  assert.strictEqual(board.base, '2026-10-31T01:02:03.000Z');
  const data = dataOf(html);
  assert.deepStrictEqual(data.board, board);
  assert.deepStrictEqual(board.snapshot, { query: '', archive: true, label: 'with the archive' });
  const storage = memoryStorage();
  const src = boot(data, { storage, device: 'd1' });
  const load = (await src.request('GET', '/api/board')).json;
  assert.strictEqual(load.projectName, 'fixture');
  assert.strictEqual(load.active.length, 18);
  assert.ok(load.archived.length > 0);
  assert.deepStrictEqual(load.source, { kind: 'page', queued: 0, pictures: false, base: data.board.base });
  const id = load.active.find((c) => c.status === 'todo').id;
  assert.strictEqual((await src.request('PATCH', `/api/cards/${id}`, { status: 'backlog' })).status, 200);
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 1);
  assert.strictEqual(boot(data, { storage, device: 'd1' }).records().length, 1);
});

test('the file holds no path of the machine that built it', () => {
  const { html } = buildPage({ boardDir: FIXTURE });
  for (const form of new Set([FIXTURE, FIXTURE.replace(/\\/g, '/'), FIXTURE.replace(/\\/g, '\\\\'), path.dirname(FIXTURE)])) assert.ok(!html.includes(form), form);
});

test('a scratchpad folder outside the board folder comes along, at the place the config names', async () => {
  const root = tmpTree({
    'proj/.kanban/config.yaml': 'name: padded\nnextId: 9\nscratchpad: ../pads/<card>\n',
    'proj/.kanban/0007.seven.card.md': card(7, 'Seven'),
    'proj/pads/0007.seven/0007.scratchpad.md': 'page body\n',
    'proj/pads/0007.seven/notes.md': 'notes here\n',
    'proj/pads/0007.seven/blob.bin': Buffer.from([0, 1, 2, 0]),
  });
  try {
    const { html } = buildPage({ boardDir: path.join(root, 'proj', '.kanban') });
    const data = dataOf(html);
    const names = Object.keys(data.files);
    assert.ok(names.some((f) => f.endsWith('/proj/pads/0007.seven/notes.md')), names.join('\n'));
    assert.ok(!names.some((f) => f.endsWith('blob.bin')), 'a binary file is left out');
    const src = boot(data, { storage: memoryStorage(), device: 'd' });
    const page = (await src.request('GET', '/api/scratchpad/7')).json;
    assert.match(page.pad.body, /page body/);
    assert.deepStrictEqual((await src.request('GET', '/api/scratchpad/7/files?path=')).json.entries.map((e) => e.name).sort(), ['0007.scratchpad.md', 'notes.md']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a board with no name takes its name from the folder that holds it, as the server does', async () => {
  const root = tmpTree({ 'shipyard/.kanban/0001.one.card.md': card(1, 'One') });
  try {
    const { html, board } = buildPage({ boardDir: path.join(root, 'shipyard', '.kanban') });
    assert.strictEqual(board.name, 'shipyard');
    assert.strictEqual((await boot(dataOf(html), { storage: memoryStorage(), device: 'd' }).request('GET', '/api/board')).json.projectName, 'shipyard');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the board id tells two boards apart even when they share a name, and one board always has the same id', () => {
  const a = tmpTree({ 'one/.kanban/config.yaml': 'name: same\nnextId: 2\n', 'one/.kanban/0001.x.card.md': card(1, 'X') });
  const b = tmpTree({ 'two/.kanban/config.yaml': 'name: same\nnextId: 2\n', 'two/.kanban/0001.x.card.md': card(1, 'X') });
  try {
    const dirA = path.join(a, 'one', '.kanban');
    const dirB = path.join(b, 'two', '.kanban');
    assert.notStrictEqual(buildPage({ boardDir: dirA }).board.id, buildPage({ boardDir: dirB }).board.id);
    assert.strictEqual(buildPage({ boardDir: dirA }).board.id, buildPage({ boardDir: dirA }).board.id);
    assert.match(buildPage({ boardDir: dirA }).board.id, /^[0-9a-f]{12}$/);
  } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});

test('a folder that is not a board is refused with a plain message', () => {
  assert.throws(() => buildPage({ boardDir: path.join(os.tmpdir(), 'kanban-artifact-nothing-here') }), /Board dir not found/);
});

test('the command writes the file named by --out and says how big it is; a missing board is exit 2', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-out-')), 'board.html');
  try {
    const ran = spawnSync(process.execPath, [SCRIPT, FIXTURE, '--out', out], { encoding: 'utf8' });
    assert.strictEqual(ran.status, 0, ran.stderr);
    assert.ok(fs.readFileSync(out, 'utf8').startsWith('<!DOCTYPE html>'));
    assert.match(ran.stdout, /board\.html/);
    const bad = spawnSync(process.execPath, [SCRIPT, path.join(os.tmpdir(), 'kanban-artifact-nothing-here'), '--out', out], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /Board dir not found/);
    assert.strictEqual(spawnSync(process.execPath, [SCRIPT, FIXTURE], { encoding: 'utf8' }).status, 2);
  } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
});

test('a card body that holds script tags, comment openers or line separators stays inside its data block and comes back whole', () => {
  const body = ['</script><b>x</b>', '<!-- not a comment -->', `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`].join('\n');
  const root = tmpTree({ 'p/.kanban/0001.one.card.md': card(1, 'One').replace('body of 1', body) });
  try {
    const { html } = buildPage({ boardDir: path.join(root, 'p', '.kanban') });
    const block = html.match(/<script type="application\/json" id="kanban-board">([\s\S]*?)<\/script>/)[1];
    assert.ok(!block.includes('<'), 'no "<" is left raw in the data block');
    assert.ok(!block.includes(String.fromCharCode(0x2028)) && !block.includes(String.fromCharCode(0x2029)));
    assert.ok(Object.values(dataOf(html).files).some((text) => text.includes(body)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('what Copy changes copies from a built page is read by the apply, and lands the same save on the board it was built from', async () => {
  const { applyTray, parseTray } = require('../../plugin/skills/web/scripts/apply-tray');
  const root = tmpTree({ 'p/.kanban/config.yaml': 'name: round\nnextId: 9\n', 'p/.kanban/0001.one.card.md': card(1, 'One'), 'p/.kanban/0002.two.card.md': card(2, 'Two') });
  try {
    const dir = path.join(root, 'p', '.kanban');
    const src = boot(dataOf(buildPage({ boardDir: dir }).html), { storage: memoryStorage(), device: 'phone' });
    await src.request('PATCH', '/api/cards/1', { status: 'doing' });
    await src.request('POST', '/api/cards/2/archive', {});
    const report = applyTray({ dir, records: parseTray(src.payload()) });
    assert.strictEqual(report.applied.length, 2, JSON.stringify(report));
    assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^status: doing$/m);
    assert.ok(fs.existsSync(path.join(dir, 'archived', '0002.two.card.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a file rebuilt from the same board does not replay a tray that was already applied to the board', async () => {
  const { applyTray, parseTray } = require('../../plugin/skills/web/scripts/apply-tray');
  const root = tmpTree({ 'p/.kanban/config.yaml': 'name: again\nnextId: 5\n', 'p/.kanban/0001.one.card.md': card(1, 'One') });
  try {
    const dir = path.join(root, 'p', '.kanban');
    const storage = memoryStorage();
    const first = boot(dataOf(buildPage({ boardDir: dir, now: () => new Date('2026-10-31T01:00:00.000Z') }).html), { storage, device: 'phone' });
    assert.strictEqual((await first.request('POST', '/api/cards', { title: 'New one', status: 'todo' })).status, 201);
    assert.strictEqual(applyTray({ dir, records: parseTray(first.payload()) }).applied.length, 1);
    const rebuilt = boot(dataOf(buildPage({ boardDir: dir, now: () => new Date('2026-10-31T02:00:00.000Z') }).html), { storage, device: 'phone' });
    const load = (await rebuilt.request('GET', '/api/board')).json;
    assert.strictEqual(load.source.queued, 0);
    assert.strictEqual(load.active.filter((c) => c.title === 'New one').length, 1);
    const reopened = boot(dataOf(buildPage({ boardDir: dir, now: () => new Date('2026-10-31T02:00:00.000Z') }).html), { storage, device: 'phone' });
    assert.strictEqual(reopened.records().length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('two files built from one board at two moments keep their own queues in one browser', async () => {
  const root = tmpTree({ 'p/.kanban/config.yaml': 'name: twice\nnextId: 5\n', 'p/.kanban/0001.one.card.md': card(1, 'One') });
  try {
    const dir = path.join(root, 'p', '.kanban');
    const storage = memoryStorage();
    const old = dataOf(buildPage({ boardDir: dir, now: () => new Date('2026-10-31T01:00:00.000Z') }).html);
    const fresh = dataOf(buildPage({ boardDir: dir, now: () => new Date('2026-10-31T02:00:00.000Z') }).html);
    await boot(old, { storage, device: 'd' }).request('PATCH', '/api/cards/1', { status: 'doing' });
    assert.strictEqual(boot(old, { storage, device: 'd' }).records().length, 1);
    assert.strictEqual(boot(fresh, { storage, device: 'd' }).records().length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
