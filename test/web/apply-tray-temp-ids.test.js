const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyTray, formatReport } = require('../../plugin/skills/web/scripts/apply-tray');

// A card made in a page has a temporary id (n1), and later changes may name it. The apply allocates the real
// id through the board's own route when it replays the save that made the card, and puts that id where the
// later saves named n1, in tray order, so a child's parent, a note's target and a group's member land on the
// card the board made.

const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const SEED = {
  'config.yaml': 'name: t\nnextId: 30\ngroups: .groups\nlogbook: logbook\nscratchpad: .pads\ntodos: .todos\n',
  '0003.three.card.md': card(3, 'Three'),
  '.groups/.keep': '',
};

function makeBoard() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-temp-'));
  const dir = path.join(root, '.kanban');
  for (const [name, text] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

let counter = 0;
const rec = (method, p, body, extra = {}) => ({ id: `phone-${++counter}`, at: '2026-10-31T09:00:00', device: 'phone', change: { method, path: p, body }, ...extra });
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const cardFile = (dir, id) => fs.readdirSync(dir).find((f) => f.startsWith(`${String(id).padStart(4, '0')}.`) && f.endsWith('.card.md'));

const TRAY = () => [
  rec('POST', '/api/cards', { title: 'Made on the phone' }, { temp: 'n1' }),
  rec('POST', '/api/cards', { title: 'Its child', parent: 'n1' }, { temp: 'n2' }),
  rec('POST', '/api/notes', { target: 'n1', day: '2026-10-31', at: '09:00', by: '@human', note: 'a note on the new card' }),
  rec('POST', '/api/groups', { name: 'Trip', cards: ['3', 'n1'] }, { temp: 'n3' }),
  rec('PATCH', '/api/cards/n2', { priority: 'High' }),
];

test('the apply gives each new card the real id the board allocates and maps later saves to it, in tray order', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: TRAY() });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, 5);
  assert.deepStrictEqual(report.temp, { n1: '30', n2: '31', n3: '_1' });

  assert.ok(cardFile(dir, 30));
  assert.match(read(dir, cardFile(dir, 30)), /# Made on the phone/);
  const child = read(dir, cardFile(dir, 31));
  assert.match(child, /parent: 30\b/);
  assert.match(child, /priority: High/);
  assert.match(read(dir, 'logbook/2026.10.31.0030.logbook.md'), /a note on the new card/);
  assert.match(read(dir, '.groups/_0001.trip.md'), /cards: \[3, 30\]/);
  assert.ok(!fs.readdirSync(dir).some((f) => /^n\d/.test(f)));
});

test('the report names the map of temporary ids to real ones', () => {
  const dir = makeBoard();
  const text = formatReport(applyTray({ dir, records: TRAY().slice(0, 2) }));
  assert.match(text, /n1 is now #30/);
  assert.match(text, /n2 is now #31/);
});

test('a save that names a temporary id whose card was refused is refused with that reason, and the rest still apply', () => {
  const dir = makeBoard();
  const tray = [
    rec('POST', '/api/cards', { title: 'Waits on nothing real', status: 'doing', waiting_for: ['3'] }, { temp: 'n1' }),
    rec('POST', '/api/cards', { title: 'Child', parent: 'n1' }, { temp: 'n2' }),
    rec('PATCH', '/api/cards/3', { priority: 'High' }),
  ];
  const report = applyTray({ dir, records: tray });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [tray[2].id]);
  assert.deepStrictEqual(report.refused.map((r) => r.id), [tray[0].id, tray[1].id]);
  assert.match(report.refused[0].reason, /waiting/);
  assert.match(report.refused[1].reason, /n1/);
  assert.ok(!fs.readdirSync(dir).some((f) => /Child/i.test(f) || f.includes('child')));
});

test('a save that names a temporary id no record of the tray made is refused and says which', () => {
  const dir = makeBoard();
  const tray = [rec('PATCH', '/api/cards/n9', { priority: 'High' })];
  const report = applyTray({ dir, records: tray });
  assert.deepStrictEqual(report.applied, []);
  assert.match(report.refused[0].reason, /n9/);
});

test('text that reads like a temporary id is not rewritten', () => {
  const dir = makeBoard();
  const tray = [
    rec('POST', '/api/cards', { title: 'n1', body: 'see n1' }, { temp: 'n1' }),
    rec('PATCH', '/api/cards/3', { title: 'n1' }),
  ];
  applyTray({ dir, records: tray });
  assert.match(read(dir, cardFile(dir, 3)), /# n1/);
  assert.match(read(dir, cardFile(dir, 30)), /see n1/);
});

test('a tray applied twice makes the card once: the second time every record reads as already applied', () => {
  const dir = makeBoard();
  const tray = TRAY();
  applyTray({ dir, records: tray });
  const again = applyTray({ dir, records: tray });
  assert.deepStrictEqual(again.applied, []);
  assert.strictEqual(again.skipped.length, 5);
  assert.ok(!cardFile(dir, 33));
});

test('what the dry run allocates is what the apply allocates, so the report names the cards the files hold', () => {
  const dir = makeBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nnextId: 12\ngroups: .groups\nlogbook: logbook\n');
  const report = applyTray({ dir, records: TRAY().slice(0, 2) });
  assert.deepStrictEqual(report.temp, { n1: '12', n2: '13' });
  assert.ok(cardFile(dir, 12) && cardFile(dir, 13));
});
