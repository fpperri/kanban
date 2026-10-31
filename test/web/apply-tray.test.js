const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');
const { applyTray, parseTray, APPLIED_FILE } = require('../../plugin/skills/web/scripts/apply-tray');
const { read } = require('./helpers/doc-text');
const cs = require('../../plugin/skills/web/scripts/card-store');
const { versionOf } = require('../../plugin/skills/web/scripts/store-common');

// The apply replays a tray's saves through route(), so a board it leaves is the board the same saves
// made at the desk would leave. These tests drive it through a board folder and read the files.

const SCRIPT = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'apply-tray.js');
const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra}tags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;

const SEED = {
  'config.yaml': 'name: t\nnextId: 30\ntodos: .todos\nassignees:\n  - handle: "@alex"\n    name: "Alex"\n',
  '0003.three.card.md': card(3, 'Three'),
  '0007.seven.card.md': card(7, 'Seven', 'waiting_for: [3]\n'),
  '0012.twelve.card.md': card(12, 'Twelve'),
  '0015.fifteen.card.md': card(15, 'Fifteen'),
  'archived/0002.two.card.md': card(2, 'Two'),
  '.todos/0003.todo.md': '- [ ] a\n- [ ] b\n',
};

function makeBoard(files = SEED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-tray-'));
  const dir = path.join(root, '.kanban');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

// Every file under the board folder, name to text, with the clock stamps and the applied-ids file out.
function snapshot(dir) {
  const out = {};
  const walk = (folder, rel) => {
    for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(folder, e.name), r);
      else if (r !== APPLIED_FILE) out[r] = fs.readFileSync(path.join(folder, e.name), 'utf8').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/g, 'STAMP');
    }
  };
  walk(dir, '');
  return out;
}

let counter = 0;
const rec = (method, p, body, extra = {}) => ({ id: `phone-${++counter}`, at: '2026-10-31T09:00:00', device: 'phone', change: { method, path: p, body }, ...extra });

const TRAY = () => [
  rec('POST', '/api/cards', { title: 'Made on the phone', status: 'todo' }),
  rec('PATCH', '/api/cards/3', { title: 'Three, renamed', priority: 'High' }),
  rec('PATCH', '/api/cards/15', { status: 'doing' }),
  rec('POST', '/api/cards/12/archive', {}),
];

test('a tray of a create, an edit, a move and an archive leaves the files the same saves at the desk would', () => {
  const tray = TRAY();
  const phone = makeBoard();
  const report = applyTray({ dir: phone, records: tray });
  assert.deepStrictEqual(report.applied.map((a) => a.id), tray.map((r) => r.id));
  assert.deepStrictEqual(report.refused, []);

  const desk = makeBoard();
  const route = makeRoute(desk);
  for (const r of tray) assert.ok(route(r.change.method, r.change.path, r.change.body).status < 400);
  assert.deepStrictEqual(snapshot(phone), snapshot(desk));
  assert.ok(fs.existsSync(path.join(phone, 'archived', '0012.twelve.card.md')));
  assert.match(fs.readFileSync(path.join(phone, '0015.fifteen.card.md'), 'utf8'), /status: doing/);
});

test('a record the board refuses is reported with the desk\'s reason and the others still land', () => {
  const board = makeBoard();
  const refusedByDesk = makeRoute(makeBoard())('PATCH', '/api/cards/7', { status: 'doing' });
  assert.strictEqual(refusedByDesk.status, 422);

  const before = rec('PATCH', '/api/cards/12', { priority: 'Low' });
  const gated = rec('PATCH', '/api/cards/7', { status: 'doing' });
  const after = rec('PATCH', '/api/cards/15', { priority: 'High' });
  const report = applyTray({ dir: board, records: [before, gated, after] });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [before.id, after.id]);
  assert.deepStrictEqual(report.refused, [{ id: gated.id, reason: refusedByDesk.body.error }]);
  assert.match(fs.readFileSync(path.join(board, '0007.seven.card.md'), 'utf8'), /status: todo/);
  assert.match(fs.readFileSync(path.join(board, '0012.twelve.card.md'), 'utf8'), /priority: Low/);
  assert.match(fs.readFileSync(path.join(board, '0015.fifteen.card.md'), 'utf8'), /priority: High/);
  assert.deepStrictEqual(fs.readFileSync(path.join(board, APPLIED_FILE), 'utf8').trim().split('\n'), [before.id, after.id]);
});

test('the same tray applied twice changes nothing the second time and every record reads as already applied', () => {
  const board = makeBoard();
  const tray = TRAY();
  applyTray({ dir: board, records: tray });
  const once = snapshot(board);
  const idsOnce = fs.readFileSync(path.join(board, APPLIED_FILE), 'utf8');

  const again = applyTray({ dir: board, records: tray });
  assert.deepStrictEqual(again.applied, []);
  assert.deepStrictEqual(again.refused, []);
  assert.deepStrictEqual(again.skipped, tray.map((r) => r.id));
  assert.deepStrictEqual(snapshot(board), once);
  assert.strictEqual(fs.readFileSync(path.join(board, APPLIED_FILE), 'utf8'), idsOnce);
});

test('a record repeated inside one tray applies once', () => {
  const board = makeBoard();
  const r = rec('POST', '/api/cards/12/archive', {});
  const report = applyTray({ dir: board, records: [r, r] });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [r.id]);
  assert.deepStrictEqual(report.skipped, [r.id]);
});

test('a dry run that cannot be made writes nothing to the real board', () => {
  const board = makeBoard();
  const before = snapshot(board);
  // a folder named like a card file that the memory copy cannot read as a file makes the copy throw
  const blocked = path.join(board, 'config.yaml');
  fs.rmSync(blocked);
  fs.mkdirSync(blocked);
  const tray = TRAY();
  assert.throws(() => applyTray({ dir: board, records: tray }));
  fs.rmSync(blocked, { recursive: true });
  fs.writeFileSync(blocked, SEED['config.yaml']);
  assert.deepStrictEqual(snapshot(board), before);
  assert.ok(!fs.existsSync(path.join(board, APPLIED_FILE)));
});

test('a refused record writes nothing of its own, even when a later record passes', () => {
  const board = makeBoard();
  const before = snapshot(board);
  const report = applyTray({ dir: board, records: [rec('PATCH', '/api/cards/7', { status: 'doing' }), rec('PATCH', '/api/cards/99', { priority: 'High' })] });
  assert.deepStrictEqual(report.applied, []);
  assert.strictEqual(report.refused.length, 2);
  assert.deepStrictEqual(snapshot(board), before);
  assert.ok(!fs.existsSync(path.join(board, APPLIED_FILE)));
});

test('a record that is not a save, or has no id, is refused and the rest still apply', () => {
  const board = makeBoard();
  const good = rec('POST', '/api/cards/12/archive', {});
  const report = applyTray({ dir: board, records: [
    rec('GET', '/api/board'),
    { change: { method: 'POST', path: '/api/cards/3/archive' } },
    { id: 'x-1', change: { method: 'POST', path: '/not-api' } },
    'nonsense',
    good,
  ] });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [good.id]);
  assert.strictEqual(report.refused.length, 4);
  assert.ok(fs.existsSync(path.join(board, '0003.three.card.md')));
});

test('a save of a todo list, a note and a scratchpad lands through the same routes', () => {
  const board = makeBoard({ ...SEED, 'config.yaml': 'name: t\nnextId: 30\ntodos: .todos\nlogbook: .logbook\nscratchpad: ../pads/<card>\n' });
  const route = makeRoute(board);
  const todo = route('GET', '/api/todos/3').body.todos;
  const tray = [
    rec('PUT', '/api/todos/3', { text: '- [x] a\n- [ ] b\n- [ ] c\n', version: todo.version }),
    rec('POST', '/api/notes', { day: '2026-10-31', target: '3', at: '09:00', note: 'from the phone' }),
    rec('PUT', '/api/scratchpad/3', { body: 'pad text' }),
  ];
  const fresh = makeBoard({ ...SEED, 'config.yaml': 'name: t\nnextId: 30\ntodos: .todos\nlogbook: .logbook\nscratchpad: ../pads/<card>\n' });
  const report = applyTray({ dir: fresh, records: tray });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(fs.readFileSync(path.join(fresh, '.todos', '0003.todo.md'), 'utf8'), '- [x] a\n- [ ] b\n- [ ] c\n');
  assert.match(fs.readFileSync(path.join(fresh, '.logbook', '2026.10.31.0003.logbook.md'), 'utf8'), /from the phone/);
  const padFolder = path.join(path.dirname(fresh), 'pads', fs.readdirSync(path.join(path.dirname(fresh), 'pads'))[0]);
  assert.strictEqual(fs.readFileSync(path.join(padFolder, '0003.scratchpad.md'), 'utf8').trim(), 'pad text');
});

test('a scratchpad folder outside the board is part of the dry run and of the apply', () => {
  const cfg = 'name: t\nnextId: 30\nscratchpad: ../pads/<card>\n';
  const board = makeBoard({ ...SEED, 'config.yaml': cfg });
  const pads = path.join(path.dirname(board), 'pads', '3');
  fs.mkdirSync(pads, { recursive: true });
  fs.writeFileSync(path.join(pads, 'notes.md'), 'old\n');
  const version = versionOf('old\n');
  const report = applyTray({ dir: board, records: [rec('PUT', '/api/scratchpad/3/file', { path: 'notes.md', text: 'new\n', version })] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(fs.readFileSync(path.join(pads, 'notes.md'), 'utf8'), 'new\n');
});

test('the applied-ids file is not a card: the board lists the same cards with and without it', () => {
  const board = makeBoard();
  const names = () => cs.listActive(board).map((c) => c.id);
  const without = names();
  applyTray({ dir: board, records: [rec('POST', '/api/cards/12/archive', {})] });
  assert.ok(fs.existsSync(path.join(board, APPLIED_FILE)));
  assert.deepStrictEqual(names(), without.filter((id) => id !== '12'));
  assert.ok(!fs.readdirSync(board).some((f) => f.endsWith('.card.md') && f.startsWith('.')));
});

test('parseTray reads an array, one record per line, and a payload with a header line and a fence', () => {
  const a = rec('POST', '/api/cards/12/archive', {});
  const b = rec('PATCH', '/api/cards/3', { priority: 'Low' });
  assert.deepStrictEqual(parseTray(JSON.stringify([a, b])), [a, b]);
  assert.deepStrictEqual(parseTray(`${JSON.stringify(a)}\n${JSON.stringify(b)}\n`), [a, b]);
  assert.deepStrictEqual(parseTray(`Apply kanban changes (board t, base 2026-10-31T09:00:00, 2 queued)\n\`\`\`\n${JSON.stringify(a)}\n${JSON.stringify(b)}\n\`\`\`\n`), [a, b]);
  assert.deepStrictEqual(parseTray('Apply kanban changes (board t, 0 queued)\n'), []);
  assert.throws(() => parseTray('header\n{"id": 1}\n{oops'), /line 2/);
});

test('the command applies a tray file to a board folder and prints the report', () => {
  const board = makeBoard();
  const tray = path.join(path.dirname(board), 'tray.json');
  const good = rec('POST', '/api/cards/12/archive', {});
  const gated = rec('PATCH', '/api/cards/7', { status: 'doing' });
  fs.writeFileSync(tray, JSON.stringify([good, gated]));
  const r = spawnSync(process.execPath, [SCRIPT, board, tray], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /applied 1, refused 1, already applied 0/);
  assert.match(r.stdout, new RegExp(`refused ${gated.id}: `));
  const again = spawnSync(process.execPath, [SCRIPT, board, tray, '--json'], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(again.stdout).skipped, [good.id]);
});

test('the command reads the tray from stdin and exits 2 on a tray it cannot read or a missing board', () => {
  const board = makeBoard();
  const good = rec('POST', '/api/cards/12/archive', {});
  const piped = spawnSync(process.execPath, [SCRIPT, board, '-'], { input: `header\n${JSON.stringify([good])}`, encoding: 'utf8' });
  assert.strictEqual(piped.status, 0, piped.stderr);
  assert.match(piped.stdout, /applied 1/);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT, board, '-'], { input: 'h\n{oops', encoding: 'utf8' }).status, 2);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT, path.join(board, 'nope'), '-'], { input: '[]', encoding: 'utf8' }).status, 2);
  assert.strictEqual(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2);
});

test('the skill\'s command and the hidden file it names are the script\'s own', () => {
  const skill = read('plugin', 'skills', 'artifact', 'SKILL.md');
  const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).stderr.trim();
  assert.strictEqual(usage, 'usage: apply-tray <board-dir> <tray-file | -> [--json]');
  assert.ok(skill.includes('node skills/web/scripts/apply-tray.js <kanban-directory> <tray-file | -> [--json]'));
  assert.ok(skill.includes(`\`${APPLIED_FILE}\``));
  assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'apply-tray.js')));
});

test('the board scripts list the same cards with the applied-ids file in the folder', { skip: spawnSync('bash', ['--version']).status === 0 ? false : 'bash is not available' }, () => {
  const board = makeBoard();
  const script = path.join(__dirname, '..', '..', 'plugin', 'skills', 'kanban', 'scripts', 'list_all_cards.sh');
  const lf = path.join(path.dirname(board), 'list_all_cards.sh');
  fs.writeFileSync(lf, fs.readFileSync(script, 'utf8').replace(/\r\n/g, '\n'));
  const list = () => spawnSync('bash', [lf, board], { encoding: 'utf8' }).stdout.replace(/\r\n/g, '\n');
  const without = list();
  fs.writeFileSync(path.join(board, APPLIED_FILE), 'phone-1\nphone-2\n');
  assert.ok(without.includes('Fifteen'));
  assert.strictEqual(list(), without);
});

// The queued change a page leaves for edits to the list of card 3, made over the seed board.
async function pageEdits() {
  const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
  const { makePageSource, makeTrayStore } = require('../../plugin/skills/web/scripts/page-source');
  const { routeSources } = require('./helpers/route-sources');
  const files = {};
  for (const [name, text] of Object.entries(SEED)) files[`/p/.kanban/${name}`] = text;
  const { route } = makeMemoryRoute(routeSources(), { files, dir: '/p/.kanban' });
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
  const src = makePageSource({ route, tray: makeTrayStore(storage, 'tray', 'phone'), board: { name: 't', id: 'b', base: 'x' } });
  const list = async () => (await src.request('GET', '/api/todos/3')).json.todos;
  await src.request('POST', '/api/todos/3', { text: 'c', version: (await list()).version });
  await src.request('PATCH', '/api/todos/3', { index: 0, done: true, version: (await list()).version });
  await src.request('POST', '/api/todos/3/move', { index: 2, by: -1, version: (await list()).version });
  return { records: src.records(), shown: (await list()).text };
}

test('edits to one todo list made in a page land as the list the page showed', async () => {
  const { records, shown } = await pageEdits();
  assert.strictEqual(records.length, 1);
  const board = makeBoard();
  const report = applyTray({ dir: board, records });
  assert.deepStrictEqual(report.refused, []);
  assert.deepStrictEqual(report.applied.map((a) => a.id), [records[0].id]);
  assert.strictEqual(shown, '- [x] a\n- [ ] c\n- [ ] b\n');
  assert.strictEqual(fs.readFileSync(path.join(board, '.todos', '0003.todo.md'), 'utf8'), shown);
});

test('a todo list changed at the desk since the build refuses the page\'s whole-list save as stale, with the desk\'s reason', async () => {
  const { records } = await pageEdits();
  const board = makeBoard();
  const route = makeRoute(board);
  const read = route('GET', '/api/todos/3').body.todos;
  assert.strictEqual(route('POST', '/api/todos/3', { text: 'at the desk', version: read.version }).status, 201);
  const stale = route('POST', '/api/todos/3', { text: 'x', version: read.version });
  assert.strictEqual(stale.status, 409);
  const after = fs.readFileSync(path.join(board, '.todos', '0003.todo.md'), 'utf8');

  const report = applyTray({ dir: board, records });
  assert.deepStrictEqual(report.applied, []);
  assert.deepStrictEqual(report.refused, [{ id: records[0].id, reason: stale.body.error }]);
  assert.match(report.refused[0].reason, /changed on disk/);
  assert.strictEqual(fs.readFileSync(path.join(board, '.todos', '0003.todo.md'), 'utf8'), after);
  assert.ok(!fs.existsSync(path.join(board, APPLIED_FILE)));
});
