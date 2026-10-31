const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyTray, parseTray, APPLIED_FILE } = require('../../plugin/skills/web/scripts/apply-tray');
const { read } = require('./helpers/doc-text');

// The old Snapshot page's payload (the snapshot skill's apply-protocol.md) applied to a board folder:
// each op lands as the protocol describes, through the same dry run and replay as a tray.

const SCRIPT = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'apply-tray.js');
const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: backlog\npriority: Normal\n${extra}tags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;

const SEED = {
  'config.yaml': 'name: t\nnextId: 30\nassignees:\n  - handle: "@alex"\n    name: "Alex"\n',
  '0003.three.card.md': card(3, 'Three'),
  '0007.seven.card.md': card(7, 'Seven', 'waiting_for: [3]\n'),
  '0012.twelve.card.md': card(12, 'Twelve'),
  '0015.fifteen.card.md': card(15, 'Fifteen'),
  '0016.sixteen.card.md': card(16, 'Sixteen'),
};

function makeBoard() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'old-payload-'));
  const dir = path.join(root, '.kanban');
  for (const [name, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const BASE = '2026-10-31T08:00:00';
const payload = (ops) => `Apply kanban changes (${ops.length} ops, base ${BASE}):\n${JSON.stringify(ops)}`;
const file = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

const ALL_FIVE = [
  { op: 'move', id: '15', to: 'todo' },
  { op: 'edit', id: '3', title: 'Three, renamed', priority: 'High', assignee: '@alex', body: 'new body', fm: { due_date: '2026-11-20', tags: '[ui, bug]', prompt: 'snapshot: do "X"' } },
  { op: 'create', title: 'Made on the phone', status: 'todo', priority: 'Low', assignee: '@alex', body: 'phone body', fm: { prompt: 'a: b' } },
  { op: 'archive', id: '12' },
  { op: 'delete', id: '16' },
];

test('a payload of a move, an edit, a create, an archive and a delete leaves the board the protocol describes', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: parseTray(payload(ALL_FIVE)) });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, 5);

  const moved = file(dir, '0015.fifteen.card.md');
  assert.match(moved, /status: todo/);
  assert.match(moved, /start_date: \d{4}-\d\d-\d\d/);
  assert.match(moved, /updated: \d{4}-\d\d-\d\dT/);

  const edited = file(dir, '0003.three.card.md');
  assert.match(edited, /priority: High/);
  assert.match(edited, /assignee: "@alex"/);
  assert.match(edited, /due_date: 2026-11-20/);
  assert.match(edited, /tags: \[ui, bug\]/);
  assert.match(edited, /prompt: "snapshot: do \\?"X\\?""/);
  assert.match(edited, /\n# Three, renamed\n\nnew body\n?$/);
  assert.ok(fs.existsSync(path.join(dir, '0003.three.card.md')), 'the file is not renamed');

  const created = file(dir, '0030.made-on-the-phone.card.md');
  assert.match(created, /id: 30/);
  assert.match(created, /status: todo/);
  assert.match(created, /priority: Low/);
  assert.match(created, /assignee: "@alex"/);
  assert.match(created, /prompt: "a: b"/);
  assert.match(created, /# Made on the phone\n\nphone body\n?$/);
  assert.match(file(dir, 'config.yaml'), /nextId: 31/);

  assert.ok(fs.existsSync(path.join(dir, 'archived', '0012.twelve.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, '0012.twelve.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, '0016.sixteen.card.md')));
});

test('the doing gate refuses a move the way the protocol says and the other ops still land', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: parseTray(payload([
    { op: 'move', id: '7', to: 'doing' },
    { op: 'move', id: '15', to: 'doing' },
    { op: 'move', id: '99', to: 'done' },
  ])) });
  assert.strictEqual(report.applied.length, 1);
  assert.strictEqual(report.refused.length, 2);
  assert.match(report.refused[0].reason, /3/);
  assert.match(file(dir, '0007.seven.card.md'), /status: backlog/);
  assert.match(file(dir, '0015.fifteen.card.md'), /status: doing/);
});

test('an edit with empty values clears the fields, and fm status moves the card like a move', () => {
  const dir = makeBoard();
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3, 'Three', 'assignee: "@alex"\ndue_date: 2026-01-01\n'));
  const report = applyTray({ dir, records: parseTray(payload([
    { op: 'edit', id: '3', assignee: '', fm: { due_date: '', status: 'done' } },
    { op: 'edit', id: '12', fm: { parent: '"fpp#4"', waiting_for: '[3, 15]', id: '99', updated: '2020-01-01T00:00:00' } },
  ])) });
  assert.deepStrictEqual(report.refused, []);
  const cleared = file(dir, '0003.three.card.md');
  assert.ok(!/assignee:/.test(cleared) && !/due_date:/.test(cleared));
  assert.match(cleared, /status: done/);
  assert.match(cleared, /end_date: \d{4}-\d\d-\d\d/);
  const twelve = file(dir, '0012.twelve.card.md');
  assert.match(twelve, /parent: "?fpp#4"?/);
  assert.match(twelve, /waiting_for: \[3, 15\]/);
  assert.match(twelve, /\nid: 12\n/);
  assert.ok(!/2020-01-01/.test(twelve));
});

test('a front-matter key no save writes refuses that op alone, with the reason', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: parseTray(payload([
    { op: 'edit', id: '3', fm: { 'some-custom-key': 'x' } },
    { op: 'archive', id: '12' },
    { op: 'frobnicate', id: '3' },
    { op: 'move', to: 'done' },
  ])) });
  assert.strictEqual(report.applied.length, 1);
  assert.strictEqual(report.refused.length, 3);
  assert.match(report.refused[0].reason, /some-custom-key/);
  assert.match(report.refused[1].reason, /frobnicate/);
  assert.match(report.refused[2].reason, /card id/);
  assert.ok(!/some-custom-key/.test(file(dir, '0003.three.card.md')));
});

test('the same payload pasted twice changes nothing the second time', () => {
  const dir = makeBoard();
  const text = payload(ALL_FIVE);
  applyTray({ dir, records: parseTray(text) });
  const names = fs.readdirSync(dir).sort();
  const created = file(dir, '0030.made-on-the-phone.card.md');
  const again = applyTray({ dir, records: parseTray(text) });
  assert.deepStrictEqual(again.applied, []);
  assert.strictEqual(again.skipped.length, 5);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), names);
  assert.strictEqual(file(dir, '0030.made-on-the-phone.card.md'), created);
  assert.match(file(dir, 'config.yaml'), /nextId: 31/);
});

test('two identical creates in one payload are two cards', () => {
  const dir = makeBoard();
  const op = { op: 'create', title: 'Twin', status: 'todo' };
  const report = applyTray({ dir, records: parseTray(payload([op, op])) });
  assert.strictEqual(report.applied.length, 2);
  assert.ok(fs.existsSync(path.join(dir, '0030.twin.card.md')));
  assert.ok(fs.existsSync(path.join(dir, '0031.twin.card.md')));
});

test('an old op beside a tray record in one file is read, and the record is left as it is', () => {
  const dir = makeBoard();
  const record = { id: 'phone-1', at: BASE, device: 'phone', change: { method: 'POST', path: '/api/cards/12/archive', body: {} } };
  const records = parseTray(JSON.stringify([record, { op: 'archive', id: '3' }]));
  assert.deepStrictEqual(records[0], record);
  const report = applyTray({ dir, records });
  assert.strictEqual(report.applied.length, 2);
});

test('the command applies an old payload from a file or stdin and reports it', () => {
  const dir = makeBoard();
  const trayFile = path.join(path.dirname(dir), 'payload.txt');
  fs.writeFileSync(trayFile, payload(ALL_FIVE));
  const r = spawnSync(process.execPath, [SCRIPT, dir, trayFile], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /applied 5, refused 0, already applied 0/);
  assert.ok(fs.existsSync(path.join(dir, APPLIED_FILE)));
  const piped = spawnSync(process.execPath, [SCRIPT, makeBoard(), '-'], { input: payload([{ op: 'archive', id: '12' }]), encoding: 'utf8' });
  assert.match(piped.stdout, /applied 1/);
});

test('the code carries the dated note that the old payload goes one release after the switch', () => {
  const src = fs.readFileSync(path.join(path.dirname(SCRIPT), 'old-payload.js'), 'utf8');
  assert.match(src, /Dated 2026-10-31: this goes one release after\s*\/\/ the switch/);
});

test('the artifact skill names the header the old Snapshot page writes, and the header is the page\'s own', () => {
  const skill = read('plugin', 'skills', 'artifact', 'SKILL.md');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts', 'build_editor.py'), 'utf8');
  assert.ok(page.includes('"Apply kanban changes ("+clean.length+" ops, base "+BASE+"):'));
  assert.ok(skill.includes('Apply kanban changes (N ops, base <ISO>):'));
  assert.strictEqual(parseTray('Apply kanban changes (1 ops, base 2026-10-31T08:00:00):\n[{"op":"archive","id":"3"}]').length, 1);
});

test('a fenced payload keeps its base stamp, so payloads of two builds get different ids', () => {
  const text = (base) => `\`\`\`\nApply kanban changes (1 ops, base ${base}):\n[{"op":"move","id":"15","to":"doing"}]\n\`\`\``;
  const [a] = parseTray(text('2026-10-01T08:00:00'));
  const [b] = parseTray(text('2026-10-20T08:00:00'));
  assert.strictEqual(a.at, '2026-10-01T08:00:00');
  assert.strictEqual(b.at, '2026-10-20T08:00:00');
  assert.notStrictEqual(a.id, b.id);
  const [plain] = parseTray(text('2026-10-01T08:00:00').replace(/```\n?/g, ''));
  assert.strictEqual(a.id, plain.id);
});
