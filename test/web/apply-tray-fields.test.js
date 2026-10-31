const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyTray, formatReport } = require('../../plugin/skills/web/scripts/apply-tray');
const cs = require('../../plugin/skills/web/scripts/card-store');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');

// An edit in the tray names the fields it changed and the value the page had for each (`before`). The apply
// refuses it only when one of those fields no longer holds that value ("changed at the desk since"), and
// refuses with it every later edit of the same field made on top of it (its before value is what the refused edit set). A field the edit did not
// name is never compared, so an unrelated desk edit does not block it.

const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra}tags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const SEED = {
  'config.yaml': 'name: t\nnextId: 30\n',
  '0003.three.card.md': card(3, 'Three'),
  '0007.seven.card.md': card(7, 'Seven'),
};

function makeBoard() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-fields-')), '.kanban');
  for (const [name, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

let counter = 0;
const edit = (id, body, before, extra = {}) => ({ id: `phone-${++counter}`, at: '2026-10-31T09:00:00', device: 'phone', change: { method: 'PATCH', path: `/api/cards/${id}`, body }, ...(before ? { before } : {}), ...extra });
const read = (dir, id) => cs.toJSON(cs.readCardFile(cs.findCardFile(dir, id), false));
const atDesk = (dir, id, changes) => assert.strictEqual(makeRoute(dir)('PATCH', `/api/cards/${id}`, changes).status, 200);

test('a title edit applies when the desk changed the priority since the build', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { priority: 'High' });
  const report = applyTray({ dir, records: [edit(3, { title: 'Three, renamed' }, { title: 'Three' })] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, 1);
  const now = read(dir, 3);
  assert.strictEqual(now.title, 'Three, renamed');
  assert.strictEqual(now.priority, 'High');
});

test('a title edit is refused with "changed at the desk since" when the desk changed the title, and writes nothing', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const report = applyTray({ dir, records: [edit(3, { title: 'Three, renamed' }, { title: 'Three' })] });
  assert.deepStrictEqual(report.applied, []);
  assert.strictEqual(report.refused.length, 1);
  assert.match(report.refused[0].reason, /title changed at the desk since/);
  assert.strictEqual(read(dir, 3).title, 'Three at the desk');
  assert.ok(!fs.existsSync(path.join(dir, '.applied-ids')));
});

test('a later edit of the same field, made on top of the refused one, is refused with it', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const first = edit(3, { title: 'B' }, { title: 'Three' });
  const second = edit(3, { title: 'C' }, { title: 'B' });
  const report = applyTray({ dir, records: [first, second] });
  assert.deepStrictEqual(report.applied, []);
  assert.deepStrictEqual(report.refused.map((r) => r.id), [first.id, second.id]);
  assert.match(report.refused[1].reason, new RegExp(`${first.id}.*refused`));
  assert.strictEqual(read(dir, 3).title, 'Three at the desk');
});

test('a later edit counts as made on top of a refused one when the form sent a number as text and the page held it as a number', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { rank: 9 });
  assert.strictEqual(typeof read(dir, 3).rank, 'number');
  const first = edit(3, { rank: '5' }, { rank: 3 });
  const second = edit(3, { rank: '6' }, { rank: 5 });
  const report = applyTray({ dir, records: [first, second] });
  assert.deepStrictEqual(report.applied, []);
  assert.deepStrictEqual(report.refused.map((r) => r.id), [first.id, second.id]);
  assert.match(report.refused[1].reason, new RegExp(`it depends on ${first.id}, which was refused`));
});

test('an edit redone on the refreshed page applies though the edit it redoes was refused', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Desk' });
  const first = edit(3, { title: 'B' }, { title: 'Three' }, { refused: 'title changed at the desk since' });
  const redo = edit(3, { title: 'Redo' }, { title: 'Desk' });
  const report = applyTray({ dir, records: [first, redo] });
  assert.deepStrictEqual(report.refused.map((r) => r.id), [first.id]);
  assert.deepStrictEqual(report.applied.map((a) => a.id), [redo.id]);
  assert.strictEqual(read(dir, 3).title, 'Redo');
});

test('a chain of edits, each on top of the one before, is refused from the first refused one on', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Desk' });
  const records = [edit(3, { title: 'B' }, { title: 'Three' }), edit(3, { title: 'C' }, { title: 'B' }), edit(3, { title: 'D' }, { title: 'C' })];
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.refused.map((r) => r.id), records.map((r) => r.id));
  assert.strictEqual(read(dir, 3).title, 'Desk');
});

test('a refused edit takes only the edits of its own field: another field of the card, and another card, still apply', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const records = [
    edit(3, { title: 'B' }, { title: 'Three' }),
    edit(3, { priority: 'High' }, { priority: 'Normal' }),
    edit(7, { title: 'Seven, renamed' }, { title: 'Seven' }),
  ];
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.refused.map((r) => r.id), [records[0].id]);
  assert.deepStrictEqual(report.applied.map((a) => a.id), [records[1].id, records[2].id]);
  assert.strictEqual(read(dir, 3).priority, 'High');
  assert.strictEqual(read(dir, 7).title, 'Seven, renamed');
});

test('edits made one on top of the other apply in order when the desk changed nothing', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: [edit(3, { title: 'B' }, { title: 'Three' }), edit(3, { title: 'C' }, { title: 'B' })] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(read(dir, 3).title, 'C');
});

test('a status move applies though the desk set start_date since, and keeps the start_date the desk set', () => {
  const dir = makeBoard();
  fs.writeFileSync(path.join(dir, '0005.five.card.md'), card(5, 'Five').replace('status: todo', 'status: backlog'));
  atDesk(dir, 5, { start_date: '2026-11-09' });
  const report = applyTray({ dir, records: [edit(5, { status: 'todo' }, { status: 'backlog' })] });
  assert.deepStrictEqual(report.refused, []);
  const now = read(dir, 5);
  assert.strictEqual(now.status, 'todo');
  assert.strictEqual(now.start_date, '2026-11-09');
});

test('an edit that names several fields is refused when any one changed, and says which', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { priority: 'High', tags: ['x'] });
  const report = applyTray({ dir, records: [edit(3, { title: 'B', priority: 'Low', tags: ['y'] }, { title: 'Three', priority: 'Normal', tags: [] })] });
  assert.strictEqual(report.refused.length, 1);
  assert.match(report.refused[0].reason, /priority and tags changed at the desk since/);
  assert.strictEqual(read(dir, 3).title, 'Three');
});

test('a field the page had empty compares as empty: a null before value holds for a card that still has none', () => {
  const dir = makeBoard();
  const ok = applyTray({ dir, records: [edit(3, { assignee: '@alex' }, { assignee: null })] });
  assert.deepStrictEqual(ok.refused, []);
  const other = makeBoard();
  atDesk(other, 3, { assignee: '@sam' });
  const refused = applyTray({ dir: other, records: [edit(3, { assignee: '@alex' }, { assignee: null })] });
  assert.match(refused.refused[0].reason, /assignee changed at the desk since/);
});

test('an edit of a card the tray made is not compared with the board, which has not had it', () => {
  const dir = makeBoard();
  const made = { id: 'phone-a', at: '2026-10-31T09:00:00', device: 'phone', temp: 'n1', change: { method: 'POST', path: '/api/cards', body: { title: 'New', status: 'todo' } } };
  const fix = edit('n1', { title: 'New, renamed' }, { title: 'New' });
  const report = applyTray({ dir, records: [made, fix] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, 2);
  assert.strictEqual(read(dir, report.temp.n1).title, 'New, renamed');
});

test('a before value that names a card the tray made is compared with the real id', () => {
  const dir = makeBoard();
  const made = { id: 'phone-a', at: '2026-10-31T09:00:00', device: 'phone', temp: 'n1', change: { method: 'POST', path: '/api/cards', body: { title: 'New' } } };
  const adopt = edit(3, { parent: 'n1' }, { parent: null });
  const move = edit(3, { parent: '7' }, { parent: 'n1' });
  const report = applyTray({ dir, records: [made, adopt, move] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(String(read(dir, 3).parent), '7');
});

test('a record with no before value applies as it always did', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const report = applyTray({ dir, records: [edit(3, { title: 'Three, renamed' }, undefined)] });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(read(dir, 3).title, 'Three, renamed');
});

test('the report says what was refused and why', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const r = edit(3, { title: 'B' }, { title: 'Three' });
  assert.match(formatReport(applyTray({ dir, records: [r] })), new RegExp(`refused ${r.id}: title changed at the desk since`));
});

test('applying the same tray twice after a refusal refuses the record again and applies nothing more', () => {
  const dir = makeBoard();
  atDesk(dir, 3, { title: 'Three at the desk' });
  const records = [edit(3, { title: 'B' }, { title: 'Three' }), edit(7, { priority: 'High' }, { priority: 'Normal' })];
  applyTray({ dir, records });
  const again = applyTray({ dir, records });
  assert.deepStrictEqual(again.applied, []);
  assert.strictEqual(again.skipped.length, 1);
  assert.strictEqual(again.refused.length, 1);
});
