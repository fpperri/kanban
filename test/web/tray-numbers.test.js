const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPage } = require('../../plugin/skills/web/scripts/artifact-build');
const { applyTray } = require('../../plugin/skills/web/scripts/apply-tray');
const { boot } = require('../../plugin/skills/web/scripts/page-source');
const { readApplied, takenBy } = require('../../plugin/skills/web/scripts/applied-ids');
const { routeSources } = require('./helpers/route-sources');
const { makeFakeDb, claudeWith } = require('./helpers/fake-db');

// A change's id is <device>-<number>, and the apply skips an id it has applied before. So a number a device
// took once must never come round again in a page built later, whatever the page's storage or board id.

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
};
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="kanban-board">([\s\S]*?)<\/script>/)[1]);
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;

function makeBoard(applied = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-numbers-'));
  const dir = path.join(root, '.kanban');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nnextId: 30\n');
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3, 'Three'));
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), card(7, 'Seven'));
  if (applied !== null) fs.writeFileSync(path.join(dir, '.applied-ids'), applied);
  return dir;
}

const MIN = { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' };
const SMALL = (board) => ({ board, sources: routeSources(), files: { '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\n', '/p/.kanban/0003.three.card.md': card(3, 'Three') }, dir: '/p/.kanban' });

test('takenBy reads the highest number each device took from the applied ids, and nothing from text that is no id', () => {
  assert.deepStrictEqual(takenBy(new Set(['d1-1', 'd1-3', 'd1-2', 'phone-9', 'x-y', 'plain', 'd1-0x', '-4'])), { d1: 3, 'phone': 9 });
  assert.deepStrictEqual(takenBy(new Set()), {});
});

test('the build embeds the numbers the board has applied, per device', () => {
  const dir = makeBoard('d1-1\nd1-2\nphone-7\n');
  assert.deepStrictEqual(readApplied(dir), new Set(['d1-1', 'd1-2', 'phone-7']));
  assert.deepStrictEqual(dataOf(buildPage({ boardDir: dir }).html).board.taken, { d1: 2, phone: 7 });
});

test('a board that applied nothing embeds no numbers', () => {
  assert.strictEqual(dataOf(buildPage({ boardDir: makeBoard() }).html).board.taken, undefined);
});

test('a file page starts its numbers past what the board applied for its device, with fresh storage', async () => {
  const src = boot(SMALL({ ...MIN, taken: { dev: 3 } }), { storage: memoryStorage(), device: 'dev' });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.deepStrictEqual(src.records().map((r) => r.id), ['dev-4']);
});

test('a number taken in one file is not taken again by a file built later from the same board in the same browser', async () => {
  const storage = memoryStorage();
  const first = boot(SMALL(MIN), { storage, device: 'dev' });
  await first.request('PATCH', '/api/cards/3', { status: 'doing' });
  const later = boot(SMALL({ ...MIN, base: '2026-11-01T01:00:00.000Z' }), { storage, device: 'dev' });
  await later.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.deepStrictEqual(later.records().map((r) => r.id), ['dev-2']);
});

test('a Board artifact starts its numbers past what the board applied, whatever the board id it was built with', async () => {
  for (const id of ['built-here', 'built-in-the-cloud']) {
    const fake = makeFakeDb();
    const src = boot(SMALL({ ...MIN, id, taken: { phone: 5 } }), { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
    await src.request('PATCH', '/api/cards/3', { status: 'doing' });
    assert.deepStrictEqual([...fake.docs.keys()], ['phone-6']);
  }
});

test('build, queue, apply, rebuild, queue, apply: the second change lands, with storage the rebuilt page does not share', async () => {
  const dir = makeBoard();
  const one = boot(dataOf(buildPage({ boardDir: dir }).html), { storage: memoryStorage(), device: 'dev' });
  await one.request('PATCH', '/api/cards/3', { status: 'doing' });
  const first = applyTray({ dir, records: one.records() });
  assert.deepStrictEqual(first.applied.map((a) => a.id), ['dev-1']);

  const two = boot(dataOf(buildPage({ boardDir: dir, now: () => new Date('2027-01-01T00:00:00.000Z') }).html), { storage: memoryStorage(), device: 'dev' });
  await two.request('PATCH', '/api/cards/7', { status: 'doing' });
  const second = applyTray({ dir, records: two.records() });
  assert.deepStrictEqual(second.applied.map((a) => a.id), ['dev-2']);
  assert.deepStrictEqual(second.skipped, []);
});
