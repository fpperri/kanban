const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { boot } = require('../../plugin/skills/web/scripts/page-source');
const { applyTray } = require('../../plugin/skills/web/scripts/apply-tray');
const { routeSources } = require('./helpers/route-sources');
const { makeFakeDb, claudeWith } = require('./helpers/fake-db');

// Two devices that each make a card before either has seen the other's record both take the temporary id
// n1. The page shows each device its own card; the apply makes both and puts each device's later saves on
// the card that device made, or refuses the save that cannot be told apart, saying why.

const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = { '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\n', '/p/.kanban/0003.three.card.md': card(3, 'Three') };
const DATA = { board: { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' }, sources: routeSources(), files: FILES, dir: '/p/.kanban' };
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
};
const settle = () => new Promise((r) => setTimeout(r, 5));

function makeBoardDir() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-devices-')), '.kanban');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: alpha\nnextId: 30\n');
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3, 'Three'));
  return dir;
}
const cardFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
const cardTitled = (dir, title) => cardFiles(dir).find((t) => t.includes(`# ${title}\n`));
const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);

// Each device works against a database of its own, so neither sees the other's record; the tray Claude
// reads is both databases together.
async function twoDevicesMakeACard() {
  const deskDb = makeFakeDb();
  const phoneDb = makeFakeDb();
  const desk = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(deskDb.db) });
  const phone = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(phoneDb.db) });
  const made = async (src, title) => (await src.request('POST', '/api/cards', { title })).json.id;
  assert.strictEqual(await made(desk, 'Desk card'), 'n1');
  assert.strictEqual(await made(phone, 'Phone card'), 'n1');
  assert.strictEqual((await desk.request('PATCH', '/api/cards/n1', { priority: 'High' })).status, 200);
  assert.strictEqual((await phone.request('PATCH', '/api/cards/n1', { tags: ['phone'] })).status, 200);
  const together = { ...Object.fromEntries(deskDb.docs), ...Object.fromEntries(phoneDb.docs) };
  return { together, records: Object.values(together).sort(byTime) };
}

test("two devices that each make a card before seeing the other's record both take n1, and the apply makes both cards with each device's later saves on its own", async () => {
  const { records } = await twoDevicesMakeACard();
  assert.deepStrictEqual(records.filter((r) => r.temp).map((r) => `${r.device}:${r.temp}`).sort(), ['desk:n1', 'phone:n1']);
  const dir = makeBoardDir();
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, 4);
  const desk = cardTitled(dir, 'Desk card');
  const phone = cardTitled(dir, 'Phone card');
  assert.ok(desk && phone, 'both cards were made');
  assert.match(desk, /priority: High/);
  assert.doesNotMatch(desk, /phone/);
  assert.match(phone, /tags: \[phone\]/);
  assert.match(phone, /priority: Normal/);
  assert.deepStrictEqual(Object.values(report.temp).sort(), ['30', '31']);
  assert.ok(Object.keys(report.temp).every((k) => /^n1\b/.test(k)), JSON.stringify(report.temp));
});

test('a save that names a temporary id two devices made, from a device that made none of its own, is refused with a reason that names both', async () => {
  const { records } = await twoDevicesMakeACard();
  const third = { id: 'tablet-1', at: '2999-01-01T00:00:00.000Z', device: 'tablet', change: { method: 'PATCH', path: '/api/cards/n1', body: { priority: 'High' } } };
  const dir = makeBoardDir();
  const report = applyTray({ dir, records: [...records, third] });
  assert.strictEqual(report.applied.length, 4);
  assert.strictEqual(report.refused.length, 1);
  assert.strictEqual(report.refused[0].id, 'tablet-1');
  assert.match(report.refused[0].reason, /n1/);
  assert.match(report.refused[0].reason, /desk/);
  assert.match(report.refused[0].reason, /phone/);
  assert.match(report.refused[0].reason, /which/);
});

test('a save from a device that did not make the card, when only one device made a card by that id, lands on it', async () => {
  const fake = makeFakeDb();
  const desk = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db) });
  const phone = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await desk.request('GET', '/api/board');
  await phone.request('GET', '/api/board');
  assert.strictEqual((await desk.request('POST', '/api/cards', { title: 'Desk card' })).json.id, 'n1');
  await settle();
  assert.strictEqual((await phone.request('PATCH', '/api/cards/n1', { priority: 'High' })).status, 200);
  const dir = makeBoardDir();
  const report = applyTray({ dir, records: [...fake.docs.values()].sort(byTime) });
  assert.deepStrictEqual(report.refused, []);
  assert.match(cardTitled(dir, 'Desk card'), /priority: High/);
  assert.deepStrictEqual(report.temp, { n1: '30' });
});

test("after both devices' records are in the database each page still shows its own card as n1, with its own later saves on it", async () => {
  const { together } = await twoDevicesMakeACard();
  const reload = async (device) => {
    const src = boot(DATA, { storage: memoryStorage(), device, claude: claudeWith(makeFakeDb(together).db) });
    return (await src.request('GET', '/api/board')).json;
  };
  const titled = (board, title) => board.active.filter((c) => c.title === title);
  const deskBoard = await reload('desk');
  assert.deepStrictEqual(titled(deskBoard, 'Desk card').map((c) => [String(c.id), c.priority]), [['n1', 'High']]);
  assert.strictEqual(titled(deskBoard, 'Phone card').length, 0, "the phone's card is not shown under the same id");
  assert.strictEqual(deskBoard.source.queued, 4);
  const phoneBoard = await reload('phone');
  assert.deepStrictEqual(titled(phoneBoard, 'Phone card').map((c) => [String(c.id), c.tags]), [['n1', ['phone']]]);
  assert.strictEqual(titled(phoneBoard, 'Desk card').length, 0);
});

test("a device that has seen the other's card takes the next temporary id for its own", async () => {
  const fake = makeFakeDb();
  const desk = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db) });
  const phone = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await desk.request('GET', '/api/board');
  await phone.request('GET', '/api/board');
  assert.strictEqual((await desk.request('POST', '/api/cards', { title: 'Desk card' })).json.id, 'n1');
  await settle();
  assert.strictEqual((await phone.request('POST', '/api/cards', { title: 'Phone card' })).json.id, 'n2');
  await settle();
  const board = (await desk.request('GET', '/api/board')).json;
  assert.deepStrictEqual(board.active.filter((c) => /^n/.test(String(c.id))).map((c) => `${c.id}:${c.title}`).sort(), ['n1:Desk card', 'n2:Phone card']);
});
