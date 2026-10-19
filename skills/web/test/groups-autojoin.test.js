const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');
const gs = require('../scripts/group-store');

// Auto-join (GLOSSARY.md "Ids, groups and the logbook"): a group with both dates and
// `auto_join: true` is running from its start to its end, both days included, by the local
// date of the one creating the card; a card created while it runs is written into its
// `cards:` in the same request that creates the card, and no other group takes it.

const CONFIG = 'name: t\nnextId: 30\ngroups: .groups\n';
const card = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Card ${id}\n`;

function group(id, name, { start, end, auto, cards = [] } = {}) {
  const lines = ['---', `id: ${id}`, `name: ${name}`];
  if (start) lines.push(`start_date: ${start}`);
  if (end) lines.push(`end_date: ${end}`);
  if (auto) lines.push('auto_join: true');
  lines.push(`cards: [${cards.join(', ')}]`, '---', '');
  return lines.join('\n');
}

function tmpBoard(files, config = CONFIG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-autojoin-'));
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const local = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

async function create(base, body) {
  const res = await fetch(`${base}/api/cards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const members = (dir, rel) => /^cards: (.*)$/m.exec(fs.readFileSync(path.join(dir, '.groups', rel), 'utf8'))[1];

test('a card created in the web joins every running auto-join group and no other, and the response names them', async () => {
  const dir = tmpBoard({
    '.groups/iteration/I0001.past.md': group('I1', 'past', { start: local(-20), end: local(-10), auto: true, cards: [3] }),
    '.groups/iteration/I0002.now.md': group('I2', 'now', { start: local(-3), end: local(3), auto: true, cards: [3] }),
    '.groups/iteration/I0003.soon.md': group('I3', 'soon', { start: local(2), end: local(9), auto: true }),
    '.groups/iteration/I0004.manual.md': group('I4', 'manual', { start: local(-3), end: local(3), cards: [3] }),
    '.groups/_0001.undated.md': group('_1', 'undated', { auto: true }),
    '.groups/_0002.second-now.md': group('_2', 'second now', { start: local(0), end: local(0), auto: true }),
  });
  await withServer(dir, async (base) => {
    const res = await create(base, { title: 'Fresh' });
    assert.strictEqual(res.status, 201);
    const id = res.json.id;
    assert.deepStrictEqual(res.json.joined, [{ id: 'I2', name: 'now' }, { id: '_2', name: 'second now' }]);
    assert.strictEqual(members(dir, 'iteration/I0002.now.md'), `[3, ${id}]`);
    assert.strictEqual(members(dir, '_0002.second-now.md'), `[${id}]`);
    assert.strictEqual(members(dir, 'iteration/I0001.past.md'), '[3]');
    assert.strictEqual(members(dir, 'iteration/I0003.soon.md'), '[]');
    assert.strictEqual(members(dir, 'iteration/I0004.manual.md'), '[3]');
    assert.strictEqual(members(dir, '_0001.undated.md'), '[]');
  });
});

test('a group starting or ending today is running that day, both days included', async () => {
  const dir = tmpBoard({
    '.groups/_0001.starts.md': group('_1', 'starts', { start: local(0), end: local(5), auto: true }),
    '.groups/_0002.ends.md': group('_2', 'ends', { start: local(-5), end: local(0), auto: true }),
    '.groups/_0003.ended.md': group('_3', 'ended', { start: local(-5), end: local(-1), auto: true }),
  });
  await withServer(dir, async (base) => {
    const res = await create(base, { title: 'Edge' });
    assert.deepStrictEqual(res.json.joined.map((g) => g.id), ['_1', '_2']);
    assert.strictEqual(members(dir, '_0003.ended.md'), '[]');
  });
});

test('a dated group without auto_join never takes a new card, and a card with nothing to join has an empty joined list', async () => {
  const dir = tmpBoard({ '.groups/_0001.manual.md': group('_1', 'manual', { start: local(-1), end: local(1) }) });
  await withServer(dir, async (base) => {
    const res = await create(base, { title: 'Alone' });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.json.joined, []);
    assert.strictEqual(members(dir, '_0001.manual.md'), '[]');
  });
});

test('a board with no groups: line creates cards as before', async () => {
  const dir = tmpBoard({}, 'name: t\n');
  await withServer(dir, async (base) => {
    const res = await create(base, { title: 'Plain' });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.json.joined, []);
  });
});

test('a card the doing-gate refuses joins nothing', async () => {
  const dir = tmpBoard({ '.groups/_0001.now.md': group('_1', 'now', { start: local(-1), end: local(1), auto: true }) });
  await withServer(dir, async (base) => {
    const res = await create(base, { title: 'Stuck', status: 'doing', blocked: 'no reason to go' });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(members(dir, '_0001.now.md'), '[]');
  });
});

test('joinRunning joins by the day it is given and leaves the rest of the file as written', () => {
  const text = '---\r\nid: I2\r\nname: zephyr-2\r\nstart_date: 2026-10-12\r\nend_date: 2026-10-23\r\nauto_join: true\r\nowner: "@human"\r\ncards: [3]\r\n---\r\n\r\nBody.\r\n';
  const dir = tmpBoard({ '.groups/iteration/I0002.zephyr-2.md': text });
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), card(7));
  assert.deepStrictEqual(gs.joinRunning(dir, 7, '2026-10-11'), []);
  assert.deepStrictEqual(gs.joinRunning(dir, 7, '2026-10-24'), []);
  assert.deepStrictEqual(gs.joinRunning(dir, 7, '2026-10-12'), [{ id: 'I2', name: 'zephyr-2' }]);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.groups/iteration/I0002.zephyr-2.md'), 'utf8'), text.replace('cards: [3]', 'cards: [3, 7]'));
  assert.deepStrictEqual(gs.joinRunning(dir, 7, '2026-10-23'), []);
});

test('joinRunning on a board without groups is nothing', () => {
  const dir = tmpBoard({}, 'name: t\n');
  assert.deepStrictEqual(gs.joinRunning(dir, 3, '2026-10-15'), []);
});
