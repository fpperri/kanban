const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../scripts/card-store');
const cfg = require('../scripts/config-store');
const { createServer } = require('../scripts/server');

// A card takes the prefix its type declares in `prefixes:`, when it is made, and keeps it
// for life. Each prefix has its own counter on the one `counters:` line, plain cards keep
// `nextId`, and a file name pads the number to the board's `idDigits` (ADR 0014).

function board(config, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-alloc-'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const card = (id, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra}---\n\n# Card ${id}\n`;
const CONFIG = 'nextId: 5\nprefixes:\n  G: goal\n  O: Objective\n  W: workflow/\n';
const names = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).sort();
const configText = (dir) => fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function req(base, method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('a new card of a type whose prefix is G gets G1, then G2, and the counters line follows', () => {
  const dir = board(CONFIG);
  assert.strictEqual(cs.createCard(dir, { title: 'First', type: 'goal' }).id, 'G1');
  assert.strictEqual(cs.createCard(dir, { title: 'Second', type: 'goal' }).id, 'G2');
  assert.deepStrictEqual(names(dir), ['G0001.first.card.md', 'G0002.second.card.md']);
  assert.match(configText(dir), /^nextId: 5\ncounters: \{ G: 3 \}\nprefixes:/m);
  assert.match(fs.readFileSync(path.join(dir, 'G0002.second.card.md'), 'utf8'), /^id: G2$/m);
});

test('each prefix keeps its own counter, and the type is matched without regard to case', () => {
  const dir = board(CONFIG);
  assert.strictEqual(cs.createCard(dir, { title: 'A', type: 'Goal' }).id, 'G1');
  assert.strictEqual(cs.createCard(dir, { title: 'B', type: 'objective' }).id, 'O1');
  assert.strictEqual(cs.createCard(dir, { title: 'C', type: 'goal' }).id, 'G2');
  assert.strictEqual(cs.createCard(dir, { title: 'D', type: 'OBJECTIVE' }).id, 'O2');
  assert.deepStrictEqual(cfg.readConfig(dir).counters, { G: 3, O: 3 });
});

test('a card with no type, a type without a prefix, or a folder entry takes the next plain number and leaves the counters alone', () => {
  const dir = board(CONFIG + 'counters: { G: 4 }\n');
  assert.strictEqual(cs.createCard(dir, { title: 'Bare' }).id, '5');
  assert.strictEqual(cs.createCard(dir, { title: 'Epic', type: 'epic' }).id, '6');
  assert.strictEqual(cs.createCard(dir, { title: 'Folder', type: 'workflow' }).id, '7');
  assert.match(configText(dir), /^nextId: 8$/m);
  assert.deepStrictEqual(cfg.readConfig(dir).counters, { G: 4 });
});

test('a prefix counter self-heals to the highest existing id plus one, archived cards included', () => {
  const dir = board(CONFIG + 'counters: { G: 2 }\n', {
    'G0009.old.card.md': card('G9'),
    'archived/G0011.gone.card.md': card('G11'),
    '0030.plain.card.md': card('30'),
  });
  assert.strictEqual(cs.createCard(dir, { title: 'Next', type: 'goal' }).id, 'G12');
  assert.deepStrictEqual(cfg.readConfig(dir).counters, { G: 13 });
  assert.strictEqual(cs.createCard(dir, { title: 'Plain' }).id, '31');
});

test('a prefix counter never moves for a plain card, and a plain counter never moves for a prefix', () => {
  const dir = board('nextId: 3\nprefixes:\n  G: goal\n', { 'G0040.big.card.md': card('G40') });
  assert.strictEqual(cs.createCard(dir, { title: 'Plain' }).id, '3');
  assert.strictEqual(cs.createCard(dir, { title: 'Goal', type: 'goal' }).id, 'G41');
});

test('changing a card type never changes its id or its file', () => {
  const dir = board(CONFIG);
  const made = cs.createCard(dir, { title: 'Shifty', type: 'goal' });
  assert.strictEqual(made.id, 'G1');
  const asObjective = cs.updateCard(dir, 'G1', { type: 'objective' });
  assert.strictEqual(asObjective.id, 'G1');
  assert.strictEqual(cs.updateCard(dir, 'G1', { type: 'epic' }).id, 'G1');
  assert.strictEqual(cs.updateCard(dir, 'G1', { type: '' }).id, 'G1');
  assert.deepStrictEqual(names(dir), ['G0001.shifty.card.md']);
  assert.deepStrictEqual(cfg.readConfig(dir).counters, { G: 2 }, 'a type change allocates nothing');
  assert.strictEqual(cs.createCard(dir, { title: 'Other', type: 'epic' }).id, '5', 'and a plain type made later is plain');
});

test('a card made on a board with prefixes but no config.yaml counters is still numbered from the scan', () => {
  const dir = board(null, { 'G0003.three.card.md': card('G3') });
  assert.strictEqual(cs.createCard(dir, { title: 'Plain' }).id, '1');
  assert.ok(!fs.existsSync(path.join(dir, 'config.yaml')));
});

test('file names pad the number to idDigits, and a width of its own never orphans a file', () => {
  const dir = board('nextId: 7\nidDigits: 6\nprefixes:\n  G: goal\n');
  cs.createCard(dir, { title: 'Wide' });
  cs.createCard(dir, { title: 'Goal', type: 'goal' });
  assert.deepStrictEqual(names(dir), ['000007.wide.card.md', 'G000001.goal.card.md']);
});

test('a file padded to another width still reads by its number', async () => {
  const dir = board('idDigits: 4\nprefixes:\n  G: goal\n', {
    'G0000007.seven.card.md': card('G7'),
    '000012.twelve.card.md': card('12'),
    'G8.short.card.md': card('G8'),
  });
  assert.strictEqual(path.basename(cs.findCardFile(dir, 'G7')), 'G0000007.seven.card.md');
  assert.strictEqual(path.basename(cs.findCardFile(dir, '12')), '000012.twelve.card.md');
  assert.strictEqual(cs.createCard(dir, { title: 'Next', type: 'goal' }).id, 'G9');
  assert.strictEqual(cs.createCard(dir, { title: 'Next plain' }).id, '13');
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/cards/G7/detail')).json.id, 'G7');
    assert.strictEqual((await req(base, 'PATCH', '/api/cards/G8', { priority: 'High' })).json.priority, 'High');
  });
});

test('a number wider than idDigits is written in full and the file drops its id prefix, as past 9999 always did', () => {
  const dir = board('nextId: 100\nidDigits: 2\n');
  const made = cs.createCard(dir, { title: 'Wide one' });
  assert.strictEqual(made.id, '100');
  assert.deepStrictEqual(names(dir), ['wide-one.card.md']);
  assert.strictEqual(cs.createCard(dir, { title: '!!!' }).id, '101');
  assert.ok(names(dir).includes('card-101.card.md'));
});

test('POST /api/cards gives a goal G1 then G2, and the board lists both under their whole ids', async () => {
  const dir = board(CONFIG);
  await withServer(dir, async (base) => {
    const one = await req(base, 'POST', '/api/cards', { title: 'One', type: 'goal' });
    const two = await req(base, 'POST', '/api/cards', { title: 'Two', type: 'goal' });
    const plain = await req(base, 'POST', '/api/cards', { title: 'Plain' });
    assert.deepStrictEqual([one.status, one.json.id, two.json.id, plain.json.id], [201, 'G1', 'G2', '5']);
    const listed = (await req(base, 'GET', '/api/board')).json.active.map((c) => c.id).sort();
    assert.deepStrictEqual(listed, ['5', 'G1', 'G2']);
    const moved = await req(base, 'PATCH', '/api/cards/G1', { type: 'objective' });
    assert.strictEqual(moved.json.id, 'G1');
    assert.strictEqual((await req(base, 'GET', '/api/cards/G1/detail')).status, 200);
  });
});

test('a card counter sees the groups that hold its prefix, and a group counter sees the cards', () => {
  const gs = require('../scripts/group-store');
  const config = 'groups: .groups\nprefixes:\n  G: goal\n  I: .groups/iteration\n';
  const dir = board(config, {
    '.groups/G0005.hand-written.md': '---\nid: G5\nname: hand written\ncards: []\n---\n',
    'I0007.iteration-card.card.md': card('I7'),
  });
  assert.strictEqual(cs.createCard(dir, { title: 'After the group', type: 'goal' }).id, 'G6');
  assert.strictEqual(gs.createGroup(dir, { name: 'after the card', folder: 'iteration' }).id, 'I8');
  assert.match(configText(dir), /counters: \{ G: 7, I: 9 \}/);
});
