const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../../plugin/skills/web/scripts/card-store');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');
const { applyTray } = require('../../plugin/skills/web/scripts/apply-tray');

// `workspace` and `evidence` are optional pointers on a card: where the work ran and where its proof landed.
// The board reads them as it reads any other key (tolerantly, never validated) and no surface that rewrites
// a card may add, drop or alter them.

const LINES = ['workspace: ../wt-feature', 'evidence: docs/proof/run-1'];
const pair = LINES.join('\n');
const MALFORMED_SETS = [
  ['workspace: [unclosed', 'evidence: "never closed'],
  ['workspace: C:/Users/x/wt', 'evidence: /abs/proof'],
  ['workspace: {a: b', 'evidence: ../../gone/away'],
];

function board(extra = pair) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ev-')), '.kanban');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nnextId: 30\n');
  const fm = extra ? `${extra}\n` : '';
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), `---\nid: 3\nstatus: todo\npriority: Normal\n${fm}tags: [a]\n---\n\n# Three\n\nbody\n`);
  return dir;
}
const raw = (dir) => fs.readFileSync(cs.findCardFile(dir, 3), 'utf8');
const keepsLines = (dir, lines = LINES) => {
  const r = raw(dir);
  for (const l of lines) assert.ok(r.split('\n').includes(l), `${l} survives verbatim in:\n${r}`);
};
const tray = (id, body) => ({ id, at: '2026-11-06T09:00:00', device: 'phone', change: { method: 'PATCH', path: '/api/cards/3', body } });

test('reading a card with both pointers, and with neither, never throws', () => {
  assert.strictEqual(cs.readCardFile(cs.findCardFile(board(), 3)).id, '3');
  const dir = board('');
  assert.strictEqual(cs.readCardFile(cs.findCardFile(dir, 3)).id, '3');
  assert.doesNotMatch(raw(dir), /workspace|evidence/);
});

test('malformed, dangling and absolute values are read, not rejected', () => {
  for (const set of MALFORMED_SETS) {
    const dir = board(set.join('\n'));
    const card = cs.readCardFile(cs.findCardFile(dir, 3));
    assert.strictEqual(card.id, '3');
    assert.strictEqual(card.title, 'Three');
    assert.strictEqual(cs.listActive(dir).length, 1);
    assert.strictEqual(cs.cardDetail(dir, 3).title, 'Three');
  }
});

test('an empty pointer key is read, not rejected', () => {
  const dir = board('workspace:\nevidence:');
  assert.strictEqual(cs.readCardFile(cs.findCardFile(dir, 3)).title, 'Three');
});

test('a PATCH of other fields leaves both pointers and their order untouched', () => {
  const dir = board();
  assert.strictEqual(makeRoute(dir)('PATCH', '/api/cards/3', { title: 'Renamed', priority: 'High', tags: [], status: 'doing' }).status, 200);
  keepsLines(dir);
  const r = raw(dir);
  assert.ok(r.indexOf('workspace:') < r.indexOf('evidence:'));
});

test('a PATCH leaves malformed pointer values byte-for-byte', () => {
  for (const set of MALFORMED_SETS) {
    const dir = board(set.join('\n'));
    makeRoute(dir)('PATCH', '/api/cards/3', { title: 'Renamed', status: 'done' });
    keepsLines(dir, set);
  }
});

test('archive and restore keep both pointers', () => {
  const dir = board();
  assert.strictEqual(makeRoute(dir)('POST', '/api/cards/3/archive', {}).status, 200);
  assert.ok(fs.readFileSync(cs.findCardFile(dir, 3), 'utf8').includes(pair));
  cs.restoreCard(dir, 3);
  keepsLines(dir);
});

test('a rank write from a reorder keeps both pointers', () => {
  const dir = board();
  cs.updateCard(dir, 3, { rank: 20 });
  keepsLines(dir);
});

test('the artifact apply of an edit keeps both pointers', () => {
  const dir = board();
  const report = applyTray({ dir, records: [tray('phone-1', { title: 'Renamed' })] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(cs.readCardFile(cs.findCardFile(dir, 3)).title, 'Renamed');
  keepsLines(dir);
});

test('the artifact apply of a move keeps both pointers', () => {
  const dir = board();
  assert.deepStrictEqual(applyTray({ dir, records: [tray('phone-2', { status: 'done' })] }).refused, []);
  keepsLines(dir);
});

test('a created card writes neither pointer: no empty key is emitted', () => {
  const dir = board('');
  const made = cs.createCard(dir, { title: 'New', status: 'todo' });
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, made.id), 'utf8'), /workspace|evidence/);
});

test('an edit of a card without pointers adds none', () => {
  const dir = board('');
  cs.updateCard(dir, 3, { title: 'Renamed', tags: [] });
  assert.doesNotMatch(raw(dir), /workspace|evidence/);
});

test('SKILL.md names both keys and the named-root form the path rule leans on', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'kanban', 'SKILL.md'), 'utf8');
  assert.match(doc, /`workspace`/);
  assert.match(doc, /`evidence`/);
  assert.match(doc, /`vars:`/);
  const vars = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'path-vars.js'), 'utf8');
  assert.match(vars, /`vars:`/);
});

test('the web form names neither pointer in its save payload, so a save leaves them to the store', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');
  const start = src.indexOf('async function submitModal');
  const payload = src.slice(start, src.indexOf('try {', start));
  assert.ok(payload.includes('title:'), 'found the payload');
  assert.ok(!/workspace|evidence/.test(payload));
});
