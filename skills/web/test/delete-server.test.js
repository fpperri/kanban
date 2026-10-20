const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

// Deleting through the server's HTTP API on a temporary board (GLOSSARY.md "Ids, groups and
// the logbook"): a card's id always leaves every group's list; its logbook day files go only
// when asked; a group delete can take its logbook and the member cards no other group holds.

const CONFIG = ['name: t', 'nextId: 30', 'groups: .groups', 'logbook: logbook', 'prefixes:', '  I: .groups/iteration', ''].join('\n');
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# ${title}\n`;
const day = (note) => `---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: ${note}\n---\n`;

function tmpBoard(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-delete-srv-'));
  for (const [id, title] of [[3, 'Three'], [7, 'Seven'], [15, 'Fifteen']]) fs.writeFileSync(path.join(dir, `${String(id).padStart(4, '0')}.${title.toLowerCase()}.card.md`), card(id, title));
  fs.mkdirSync(path.join(dir, 'archived'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'archived', '0002.two.card.md'), card(2, 'Two'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

async function req(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

const I1 = '---\nid: I1\nname: zephyr-1\ncards: [3, 7]\n---\n';
const I2 = '---\nid: I2\nname: zephyr-2\ncards: [7, 15]\n---\n';
const LOGS = {
  'logbook/2026.10.16.0007.logbook.md': day('seven a'),
  'logbook/2026.10.17.7.logbook.md': day('seven b'),
  'logbook/2026.10.16.0003.logbook.md': day('three'),
  'logbook/2026.10.16.logbook.md': day('loose'),
  'logbook/2026.10.16.I1.logbook.md': day('about the group'),
};

test('deleting a card takes its id out of every group file and says which', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, '.groups/iteration/0002.zephyr-2.md': I2 });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.groups, ['I1', 'I2']);
  });
  assert.ok(!exists(dir, '0007.seven.card.md'));
  assert.match(read(dir, '.groups/iteration/0001.zephyr-1.md'), /cards: \[3\]/);
  assert.match(read(dir, '.groups/iteration/0002.zephyr-2.md'), /cards: \[15\]/);
});

test('an archived card leaves the group lists too, and groups that did not hold it are not rewritten', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': '---\nid: I1\nname: a\ncards: [2]\n---\n', '.groups/iteration/0002.zephyr-2.md': I2 });
  const before = fs.statSync(path.join(dir, '.groups/iteration/0002.zephyr-2.md')).mtimeMs;
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'DELETE', '/api/cards/2')).json.groups, ['I1']);
  });
  assert.match(read(dir, '.groups/iteration/0001.zephyr-1.md'), /cards: \[\]/);
  assert.strictEqual(fs.statSync(path.join(dir, '.groups/iteration/0002.zephyr-2.md')).mtimeMs, before);
});

test('unticked, a deleted card keeps its logbook day files, which read as dangling', async () => {
  const dir = tmpBoard(LOGS);
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7', {});
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.swept, {});
  });
  assert.ok(exists(dir, 'logbook/2026.10.16.0007.logbook.md') && exists(dir, 'logbook/2026.10.17.7.logbook.md'));
});

test('with logbook: true the card day files go, whatever the padding, and no other target', async () => {
  const dir = tmpBoard(LOGS);
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7', { logbook: true });
    assert.deepStrictEqual(r.json.swept, { logbook: 2 });
  });
  assert.ok(!exists(dir, 'logbook/2026.10.16.0007.logbook.md') && !exists(dir, 'logbook/2026.10.17.7.logbook.md'));
  for (const kept of ['0003', 'I1']) assert.ok(fs.readdirSync(path.join(dir, 'logbook')).some((n) => n.includes(`.${kept}.`)), kept);
  assert.ok(exists(dir, 'logbook/2026.10.16.logbook.md'));
});

test('logbook: true on a board with no logbook line is nothing, not an error', async () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\n');
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7', { logbook: true });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.groups, []);
  });
  assert.ok(!exists(dir, '0007.seven.card.md'));
});

test('deleting a group removes its file; cards, logbook and other groups stay unless asked', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, '.groups/iteration/0002.zephyr-2.md': I2, ...LOGS });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', {});
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.json.deleted, r.json.kept, r.json.swept], [[], [], {}]);
  });
  assert.ok(!exists(dir, '.groups/iteration/0001.zephyr-1.md') && exists(dir, '.groups/iteration/0002.zephyr-2.md'));
  assert.ok(exists(dir, '0003.three.card.md') && exists(dir, 'logbook/2026.10.16.I1.logbook.md'));
});

test('a group delete with logbook: true takes the group day files only', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, ...LOGS });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'DELETE', '/api/groups/I1', { logbook: true })).json.swept, { logbook: 1 });
  });
  assert.ok(!exists(dir, 'logbook/2026.10.16.I1.logbook.md') && exists(dir, 'logbook/2026.10.16.0003.logbook.md'));
});

test('members: true deletes the members no other group holds and names the ones it kept', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, '.groups/iteration/0002.zephyr-2.md': I2, ...LOGS });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { members: true });
    assert.deepStrictEqual(r.json.deleted, ['3']);
    assert.deepStrictEqual(r.json.kept, [{ id: '7', groups: ['I2'] }]);
  });
  assert.ok(!exists(dir, '0003.three.card.md') && exists(dir, '0007.seven.card.md'));
  assert.match(read(dir, '.groups/iteration/0002.zephyr-2.md'), /cards: \[7, 15\]/);
  assert.ok(exists(dir, 'logbook/2026.10.16.0003.logbook.md'), 'the member logbook stays: the group box does not reach it');
});

test('memberLogbook and memberScratchpad, with members, take the files of the deleted members and nothing of the kept ones or the group', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, '.groups/iteration/0002.zephyr-2.md': I2, ...LOGS, '.scratchpad/0003.scratchpad.md': 'three', '.scratchpad/0007.scratchpad.md': 'seven', '.scratchpad/I0001.scratchpad.md': 'group' });
  fs.writeFileSync(path.join(dir, 'config.yaml'), `${CONFIG}scratchpad: .scratchpad\n`);
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { members: true, memberLogbook: true, memberScratchpad: true });
    assert.deepStrictEqual(r.json.deleted, ['3']);
    assert.deepStrictEqual(r.json.swept, {});
    assert.deepStrictEqual(r.json.membersSwept, { logbook: 1, scratchpad: 1 });
  });
  assert.ok(!exists(dir, 'logbook/2026.10.16.0003.logbook.md') && !exists(dir, '.scratchpad/0003.scratchpad.md'));
  assert.ok(exists(dir, 'logbook/2026.10.16.0007.logbook.md') && exists(dir, '.scratchpad/0007.scratchpad.md'), 'a member another group holds keeps its files');
  assert.ok(exists(dir, 'logbook/2026.10.16.I1.logbook.md') && exists(dir, '.scratchpad/I0001.scratchpad.md'), 'the files of the group itself wait for its own boxes');
});

test('memberLogbook and memberScratchpad without members, or unticked, are nothing', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': I1, ...LOGS });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { memberLogbook: true, memberScratchpad: true });
    assert.deepStrictEqual([r.json.deleted, r.json.membersSwept], [[], {}]);
    assert.ok(exists(dir, '0003.three.card.md') && exists(dir, 'logbook/2026.10.16.0003.logbook.md'));
    await req(base, 'DELETE', '/api/groups/I1', { members: true });
  });
  assert.ok(exists(dir, 'logbook/2026.10.16.0003.logbook.md'), 'members alone keeps the member logbook');
});

test('members: true skips a listed id that is no card, and archived members go too', async () => {
  const dir = tmpBoard({ '.groups/iteration/0001.zephyr-1.md': '---\nid: I1\nname: a\ncards: [2, 15, 99]\n---\n' });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { members: true });
    assert.deepStrictEqual(r.json.deleted, ['2', '15']);
  });
  assert.ok(!exists(dir, 'archived/0002.two.card.md') && !exists(dir, '0015.fifteen.card.md') && exists(dir, '0003.three.card.md'));
});

test('a group that is not there is a 404, and a board with no groups line refuses the route', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'DELETE', '/api/groups/I9', {})).status, 404);
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\n');
    assert.strictEqual((await req(base, 'DELETE', '/api/groups/I1', {})).status, 404);
  });
});
