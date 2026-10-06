const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = path.join(__dirname, '..', '..', 'kanban', 'scripts', 'migrate_epic_to_type.sh');

const STAMP = /^updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const CARDS = {
  '0001.launch.card.md':
    '---\nid: 1\nstatus: doing\npriority: High\nepic: true\nassignee: "@human"\nupdated: 2026-01-01T09:00:00\n---\n\n# Launch the product\n\nbody\n',
  'archived/0002.old-epic.card.md':
    '---\nid: 2\nstatus: done\npriority: Normal\nepic: true\n---\n\n# An "old" epic\n\nbody\n',
  'archived/pkg/0003.packaged.card.md':
    '---\nid: 3\nstatus: done\nepic: TRUE\ntags: [a, b]\nupdated: 2026-02-02T10:00:00\n---\n\n# Packaged epic\n',
  '0004.plain.card.md':
    '---\nid: 4\nstatus: todo\nepic: false\n---\n\n# Plain card\n\nepic: true in the body is prose.\n',
  '0005.typed.card.md':
    '---\nid: 5\nstatus: todo\ntype: objective\nepic: true\n---\n\n# Typed epic\n',
  '0006.crlf.card.md':
    '---\r\nid: 6\r\nstatus: todo\r\nepic: true\r\nupdated: 2026-03-03T11:00:00\r\n---\r\n\r\n# Windows epic\r\n',
  '0007.no-epic.card.md':
    '---\nid: 7\nstatus: todo\n---\n\n# No flag\n',
};

function tmpBoard({ name = 'fixture', notifications = '- id: 3\n  at: 2026-09-01T08:00:00\n  from: "skill:kanban"\n  level: info\n  message: "earlier; more: note"\n  read: false\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-mig-'));
  fs.mkdirSync(path.join(dir, 'archived', 'pkg'), { recursive: true });
  for (const [rel, text] of Object.entries(CARDS)) fs.writeFileSync(path.join(dir, rel), text);
  if (name) fs.writeFileSync(path.join(dir, 'config.yaml'), `name: ${name}\nnextId: 8\n`);
  if (notifications !== null) fs.writeFileSync(path.join(dir, 'notifications.md'), notifications);
  return dir;
}

const run = (dir, ...args) => execFileSync('bash', [script, dir, ...args], { encoding: 'utf8' });
const readCard = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

function snapshotDir(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// Splits a card into lines, replacing the machine-stamped `updated:` value
// with a marker so the rest can be compared literally.
function normalised(text) {
  return text.split('\n').map((l) => (STAMP.test(l.replace(/\r$/, '')) ? 'updated: <stamp>' + (l.endsWith('\r') ? '\r' : '') : l)).join('\n');
}

test('--apply turns epic: true into type: epic in place, active, archived and packaged, and nothing else changes but updated', () => {
  const dir = tmpBoard();
  run(dir, '--apply');

  assert.strictEqual(normalised(readCard(dir, '0001.launch.card.md')),
    '---\nid: 1\nstatus: doing\npriority: High\ntype: epic\nassignee: "@human"\nupdated: <stamp>\n---\n\n# Launch the product\n\nbody\n');
  assert.strictEqual(normalised(readCard(dir, 'archived/0002.old-epic.card.md')),
    '---\nid: 2\nstatus: done\npriority: Normal\ntype: epic\nupdated: <stamp>\n---\n\n# An "old" epic\n\nbody\n');
  assert.strictEqual(normalised(readCard(dir, 'archived/pkg/0003.packaged.card.md')),
    '---\nid: 3\nstatus: done\ntype: epic\ntags: [a, b]\nupdated: <stamp>\n---\n\n# Packaged epic\n');
});

test('a card with no epic flag, or epic: false, is byte-identical afterwards', () => {
  const dir = tmpBoard();
  run(dir, '--apply');
  assert.strictEqual(readCard(dir, '0004.plain.card.md'), CARDS['0004.plain.card.md']);
  assert.strictEqual(readCard(dir, '0007.no-epic.card.md'), CARDS['0007.no-epic.card.md']);
});

test('a card that already has a type keeps it and only loses epic: true', () => {
  const dir = tmpBoard();
  run(dir, '--apply');
  assert.strictEqual(normalised(readCard(dir, '0005.typed.card.md')),
    '---\nid: 5\nstatus: todo\ntype: objective\nupdated: <stamp>\n---\n\n# Typed epic\n');
});

test('a CRLF card keeps its line endings', () => {
  const dir = tmpBoard();
  run(dir, '--apply');
  assert.strictEqual(normalised(readCard(dir, '0006.crlf.card.md')),
    '---\r\nid: 6\r\nstatus: todo\r\ntype: epic\r\nupdated: <stamp>\r\n---\r\n\r\n# Windows epic\r\n');
});

test('updated is stamped with the local time of the run', () => {
  const dir = tmpBoard();
  const before = Date.now();
  run(dir, '--apply');
  const after = Date.now();
  const stamp = readCard(dir, '0001.launch.card.md').match(/^updated: (.+)$/m)[1];
  const t = new Date(stamp).getTime();
  assert.ok(t >= before - 2000 && t <= after + 2000, `${stamp} is the time of the run`);
});

test('exactly one notification is filed, with the next id and one mention per migrated card', () => {
  const dir = tmpBoard();
  run(dir, '--apply');
  const text = fs.readFileSync(path.join(dir, 'notifications.md'), 'utf8');
  const entries = text.split(/^- id: /m).slice(1);
  assert.strictEqual(entries.length, 2, 'the earlier entry plus one new one');
  const added = '- id: ' + entries[1];
  assert.match(added, /^- id: 4\n/);
  assert.match(added, /\n {2}at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\n/);
  assert.match(added, /\n {2}from: "skill:kanban"\n/);
  assert.match(added, /\n {2}level: info\n/);
  assert.match(added, /\n {2}read: false\n$/);
  const message = added.match(/\n {2}message: (".*")\n/)[1];
  assert.doesNotThrow(() => JSON.parse(message), 'a single-line double-quoted scalar');
  const msg = JSON.parse(message);
  const [tldr, detail] = msg.split('; more: ');
  assert.ok(detail, 'TLDR-first with a more: separator');
  assert.doesNotMatch(tldr, /[`#]/, 'the sentence before more: carries no card mention');
  for (const mention of [
    '`fixture#1 Launch the product`',
    '`fixture#2 An "old" epic`',
    '`fixture#3 Packaged epic`',
    '`fixture#5 Typed epic`',
    '`fixture#6 Windows epic`',
  ]) assert.ok(detail.includes(mention), `${mention} is mentioned`);
  assert.ok(!detail.includes('fixture#4') && !detail.includes('fixture#7'), 'untouched cards are not listed');
});

test('the notification names the board by the folder above the board directory when config.yaml has no name', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-home-'));
  const dir = path.join(home, '.kanban');
  fs.mkdirSync(path.join(dir, 'archived'), { recursive: true });
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), CARDS['0001.launch.card.md']);
  run(dir, '--apply');
  const text = fs.readFileSync(path.join(dir, 'notifications.md'), 'utf8');
  assert.match(text, /^- id: 1\n/, 'a missing notifications.md is created');
  assert.ok(text.includes('`' + path.basename(home) + '#1 Launch the product`'));
});

test('an existing notifications.md without a trailing newline still gets a well-formed entry', () => {
  const dir = tmpBoard({ notifications: '- id: 9\n  at: 2026-09-01T08:00:00\n  from: "skill:kanban"\n  level: info\n  message: "x; more: y"\n  read: false' });
  run(dir, '--apply');
  const text = fs.readFileSync(path.join(dir, 'notifications.md'), 'utf8');
  assert.match(text, /read: false\n- id: 10\n/);
});

test('a notifications.md with CRLF line endings gets a CRLF entry', () => {
  const crlf = ['- id: 2', '  at: 2026-09-01T08:00:00', '  from: "skill:kanban"', '  level: info', '  message: "x; more: y"', '  read: false', ''].join('\r\n');
  const dir = tmpBoard({ notifications: crlf });
  run(dir, '--apply');
  const text = fs.readFileSync(path.join(dir, 'notifications.md'), 'utf8');
  assert.ok(text.startsWith(crlf));
  assert.ok(!/[^\r]\n/.test(text), 'every line ends CRLF');
  assert.match(text, /\r\n- id: 3\r\n/);
});

test('a dry run prints what would change and touches nothing, not even the notifications', () => {
  const dir = tmpBoard();
  const before = snapshotDir(dir);
  const out = run(dir);
  assert.deepStrictEqual(snapshotDir(dir), before);
  assert.match(out, /would migrate/);
  assert.match(out, /5 file\(s\) would change/);
});

test('running --apply a second time migrates nothing and files nothing', () => {
  const dir = tmpBoard();
  run(dir, '--apply');
  const after = snapshotDir(dir);
  const out = run(dir, '--apply');
  assert.deepStrictEqual(snapshotDir(dir), after);
  assert.match(out, /0 file\(s\) migrated/);
});

test('a board with no epic cards gets no notification and no notifications.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-none-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), CARDS['0007.no-epic.card.md']);
  run(dir, '--apply');
  assert.ok(!fs.existsSync(path.join(dir, 'notifications.md')));
});

test('a missing directory is an error', () => {
  assert.throws(() => run(path.join(os.tmpdir(), 'kanban-epic-does-not-exist')), /Command failed|status 1/);
});

const demo = path.join(__dirname, '..', '..', '..', 'examples', 'demo-board');

test('the demo board has already been migrated: no epic: line, its launch card is type: epic, and a rerun finds nothing', () => {
  const cards = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.card.md')) cards.push(p);
    }
  };
  walk(demo);
  assert.ok(cards.length > 5);
  for (const f of cards) {
    const fm = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n---\n')[0];
    assert.doesNotMatch(fm, /^epic:/m, `${path.basename(f)} has no epic line`);
  }
  const launch = fs.readFileSync(path.join(demo, '0001.launch-tallybird-v1.card.md'), 'utf8');
  assert.match(launch, /^type: epic\r?$/m);

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-demo-'));
  fs.cpSync(demo, copy, { recursive: true });
  const out = run(copy, '--apply');
  assert.match(out, /0 file\(s\) migrated/);
  assert.deepStrictEqual(snapshotDir(copy), snapshotDir(demo));
});

test('the demo board gives epic its old orange in types:, so the screenshots stay truthful', () => {
  const config = fs.readFileSync(path.join(demo, 'config.yaml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(config, /^types:\n {2}- name: epic\n {4}color: "#f0883e"$/m);
});
