const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// The board answer's three config keys: the hierarchy (the types that are the
// levels of the plan, top first), the pills (each a label and a query) and a
// type's icon. Every test reads GET /api/board from a server standing on a
// board whose config.yaml is the text under test, so what is checked is what
// the page is handed.

function tmpBoard(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-keys-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\n---\n\n# One\n');
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

async function answerFor(config) {
  const srv = createServer(tmpBoard(config));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/board`);
    assert.strictEqual(res.status, 200);
    return await res.json();
  } finally { srv.close(); }
}

const hierarchyOf = async (config) => (await answerFor(config)).hierarchy;

// --- hierarchy ---------------------------------------------------------------

test('a hierarchy in flow form answers its names in order, as written', async () => {
  assert.deepStrictEqual(await hierarchyOf('hierarchy: [goal, Strategy, "objective", epic]\n'), ['goal', 'Strategy', 'objective', 'epic']);
});

test('a hierarchy in block form answers its names in order, as written', async () => {
  assert.deepStrictEqual(await hierarchyOf('hierarchy:\n  - goal\n  - "Strategy"\n  - \'objective\' # the middle\n  - epic\n'), ['goal', 'Strategy', 'objective', 'epic']);
});

test('a comment after the hierarchy key opens the block, as it does for the other lists', async () => {
  assert.deepStrictEqual(await hierarchyOf('hierarchy:   # top first\n  - goal\n  - epic\n'), ['goal', 'epic']);
});

test('a scalar hierarchy and an empty list answer an empty hierarchy', async () => {
  for (const config of ['hierarchy: goal\n', 'hierarchy: []\n', 'hierarchy:\n', 'hierarchy: "goal, epic"\n']) {
    assert.deepStrictEqual(await hierarchyOf(config), [], JSON.stringify(config));
  }
});

test('blank entries are dropped and duplicate names pass through, in both forms', async () => {
  assert.deepStrictEqual(await hierarchyOf('hierarchy: [goal, , epic, "", goal, Goal]\n'), ['goal', 'epic', 'goal', 'Goal']);
  assert.deepStrictEqual(await hierarchyOf('hierarchy:\n  - goal\n  -\n  - ""\n  - epic\n  # a comment line\n  - # only a comment\n  - goal\n'), ['goal', 'epic', 'goal']);
});

test('a hierarchy reads from CRLF text the same way', async () => {
  assert.deepStrictEqual(await hierarchyOf('name: b\r\nhierarchy:\r\n  - goal\r\n  - epic\r\nstatuses: [todo, done]\r\n'), ['goal', 'epic']);
});

test('a config without the key, or without a file, answers an empty hierarchy', async () => {
  assert.deepStrictEqual(await hierarchyOf(null), []);
  assert.deepStrictEqual(await hierarchyOf(''), []);
  assert.deepStrictEqual(await hierarchyOf('nextId: 5\n'), []);
});

test('a board that declares types but no hierarchy answers an empty hierarchy', async () => {
  assert.deepStrictEqual(await hierarchyOf('types:\n  - name: goal\n  - name: epic\n'), []);
});

// --- pills -------------------------------------------------------------------

const pillsOf = async (config) => (await answerFor(config)).pills;

test('a pill written as a quoted query, a bare query or a one-key map answers a label and a query', async () => {
  const config = [
    'pills:',
    '  - "assignee:@human"',
    "  - 'status:doing'",
    '  - blocked',
    '  - next: \'tags:"next-up"\'',
    '  - "review it": "review:"',
    '',
  ].join('\n');
  assert.deepStrictEqual(await pillsOf(config), [
    { label: 'assignee:@human', query: 'assignee:@human' },
    { label: 'status:doing', query: 'status:doing' },
    { label: 'blocked', query: 'blocked' },
    { label: 'next', query: 'tags:"next-up"' },
    { label: 'review it', query: 'review:' },
  ]);
});

test('assignee:@human and tags:* stay queries, bare or quoted', async () => {
  assert.deepStrictEqual(await pillsOf('pills:\n  - assignee:@human\n  - tags:*\n  - "tags:*"\n'), [
    { label: 'assignee:@human', query: 'assignee:@human' },
    { label: 'tags:*', query: 'tags:*' },
    { label: 'tags:*', query: 'tags:*' },
  ]);
});

test('"- tags: grill" answers the label tags with the query grill', async () => {
  assert.deepStrictEqual(await pillsOf('pills:\n  - tags: grill\n'), [{ label: 'tags', query: 'grill' }]);
});

test('a map value may be quoted, bare or carry a trailing comment, and keeps the colons inside it', async () => {
  const config = 'pills:\n  - mine: assignee:@human   # who I am\n  - both: "tags:a tags:b"  # two tags\n  - note: \'title:"fix: auth"\'\n';
  assert.deepStrictEqual(await pillsOf(config), [
    { label: 'mine', query: 'assignee:@human' },
    { label: 'both', query: 'tags:a tags:b' },
    { label: 'note', query: 'title:"fix: auth"' },
  ]);
});

test('an empty label, an empty query and a comment-only entry are skipped, and so are the rest as written', async () => {
  const config = [
    'pills:',
    '  -',
    '  - ""',
    '  - "": tags:x',
    '  - next:',
    '  - next: ""',
    '  - # only a comment',
    '  # a comment line',
    '  - tags: grill',
    '',
  ].join('\n');
  assert.deepStrictEqual(await pillsOf(config), [{ label: 'tags', query: 'grill' }]);
});

test('extra keys on a map are ignored', async () => {
  const config = 'pills:\n  - next: \'tags:"next-up"\'\n    color: red\n    query: ignored\n  - "assignee:@human"\n';
  assert.deepStrictEqual(await pillsOf(config), [
    { label: 'next', query: 'tags:"next-up"' },
    { label: 'assignee:@human', query: 'assignee:@human' },
  ]);
});

test('pills are read in block form only: a scalar, an inline list and an empty key answer none', async () => {
  for (const config of ['pills: tags:*\n', 'pills: ["tags:*", "assignee:@human"]\n', 'pills: []\n', 'pills:\n']) {
    assert.deepStrictEqual(await pillsOf(config), [], JSON.stringify(config));
  }
});

test('a config without pills, or without a file, answers empty pills', async () => {
  for (const config of [null, '', 'nextId: 5\n', 'types:\n  - name: goal\n']) {
    assert.deepStrictEqual(await pillsOf(config), [], JSON.stringify(config));
  }
});

test('pills read from CRLF text and stop at the next top-level key', async () => {
  assert.deepStrictEqual(await pillsOf('pills:\r\n  - next: "tags:next-up"\r\nstatuses: [todo, done]\r\n  - stray\r\n'), [{ label: 'next', query: 'tags:next-up' }]);
});

// --- type icons --------------------------------------------------------------

const typesOf = async (config) => (await answerFor(config)).types;

test('a type carries an icon only when one is set', async () => {
  const config = 'types:\n  - name: goal\n    color: "#a371f7"\n    icon: star\n  - name: epic\n    color: orange\n  - story\n  - name: task\n    icon: triangle\n';
  assert.deepStrictEqual(await typesOf(config), [
    { name: 'goal', color: '#a371f7', icon: 'star' },
    { name: 'epic', color: 'orange' },
    { name: 'story', color: '' },
    { name: 'task', color: '', icon: 'triangle' },
  ]);
});

test('an icon is lowercased and its trailing comment stripped, quoted or not', async () => {
  const config = 'types:\n  - name: a\n    icon: Star   # five points\n  - name: b\n    icon: "HEXAGON"\n  - name: c\n    icon: \'Diamond\' # a rhombus\n';
  assert.deepStrictEqual((await typesOf(config)).map((t) => t.icon), ['star', 'hexagon', 'diamond']);
});

test('an unknown icon name passes through, lowercased, for the page to draw as no icon', async () => {
  const config = 'types:\n  - name: a\n    icon: Blob\n  - name: b\n    icon: 3d-cube\n';
  assert.deepStrictEqual(await typesOf(config), [
    { name: 'a', color: '', icon: 'blob' },
    { name: 'b', color: '', icon: '3d-cube' },
  ]);
});

test('a blank icon is no icon, and an entry may write its icon before its name', async () => {
  const config = 'types:\n  - name: a\n    icon:\n  - name: b\n    icon: ""\n  - name: c\n    icon: # none yet\n  - icon: square\n    name: d\n';
  assert.deepStrictEqual(await typesOf(config), [
    { name: 'a', color: '' },
    { name: 'b', color: '' },
    { name: 'c', color: '' },
    { name: 'd', color: '', icon: 'square' },
  ]);
});

test('an icon on an entry with no name is dropped with the entry', async () => {
  assert.deepStrictEqual(await typesOf('types:\n  - icon: star\n  - name: epic\n'), [{ name: 'epic', color: '' }]);
});

test('an inline types list has no icons', async () => {
  assert.deepStrictEqual(await typesOf('types: [goal, epic]\n'), [{ name: 'goal', color: '' }, { name: 'epic', color: '' }]);
});

// --- the old lists stay as they were ----------------------------------------------

const OLD_BLOCKS = {
  name: 'name: plan\n',
  nextId: 'nextId: 30\n',
  assignees: 'assignees:\n  - handle: "@human"\n    name: "Human"\n    kind: human\n    description: "A person."\n  - handle: "@afk"\n    name: "Unattended"\n    kind: ai-afk\n    description: "Runs alone."\n',
  priorities: 'priorities:\n  - High\n  - Low\n',
  tags: 'tags: [skills, config]\n',
  statuses: 'statuses:\n  - todo\n  - done\n',
  types: 'types:\n  - name: goal\n    color: "#a371f7"\n  - epic\n  - name: story\n    color: red\n',
};
const NEW_BLOCKS = [
  'hierarchy:\n  - goal\n  - epic\n',
  'pills:\n  - next: "tags:next-up"\n  - "assignee:@human"\n    color: red\n  - tags: grill\n',
];
const OLD_KEYS = ['assignees', 'priorities', 'tags', 'statuses', 'types'];

test('the new keys never leak into assignees, priorities, tags, statuses or types, wherever they sit', async () => {
  const names = Object.keys(OLD_BLOCKS);
  const baseline = await answerFor(names.map((n) => OLD_BLOCKS[n]).join(''));
  assert.strictEqual(baseline.assignees.length, 2);
  assert.strictEqual(baseline.types.length, 3);
  for (const at of names.concat('end')) {
    const parts = names.map((n) => OLD_BLOCKS[n]);
    const index = at === 'end' ? parts.length : names.indexOf(at);
    parts.splice(index, 0, ...NEW_BLOCKS);
    const answer = await answerFor(parts.join(''));
    for (const key of OLD_KEYS) assert.deepStrictEqual(answer[key], baseline[key], `${key} with the new keys before ${at}`);
    assert.deepStrictEqual(answer.hierarchy, ['goal', 'epic'], `hierarchy before ${at}`);
    assert.deepStrictEqual(answer.pills, [
      { label: 'next', query: 'tags:next-up' },
      { label: 'assignee:@human', query: 'assignee:@human' },
      { label: 'tags', query: 'grill' },
    ], `pills before ${at}`);
  }
});

test('a config without the new keys answers an empty hierarchy, empty pills and the same types as before', async () => {
  const answer = await answerFor(OLD_BLOCKS.types + OLD_BLOCKS.statuses);
  assert.deepStrictEqual(answer.hierarchy, []);
  assert.deepStrictEqual(answer.pills, []);
  assert.deepStrictEqual(answer.types, [
    { name: 'goal', color: '#a371f7' },
    { name: 'epic', color: '' },
    { name: 'story', color: 'red' },
  ]);
});

test('an icon line under an assignee entry or a pill is not read as a type icon', async () => {
  const config = 'assignees:\n  - handle: "@human"\n    icon: star\ntypes:\n  - name: goal\npills:\n  - next: "x"\n    icon: star\n';
  const answer = await answerFor(config);
  assert.deepStrictEqual(answer.types, [{ name: 'goal', color: '' }]);
  assert.deepStrictEqual(answer.assignees.map((a) => a.handle), ['@human']);
  assert.deepStrictEqual(answer.pills, [{ label: 'next', query: 'x' }]);
});

// --- the hierarchy enforces nothing (ADR 0013) -------------------------------

async function withBoard(config, fn) {
  const dir = tmpBoard(config);
  fs.writeFileSync(path.join(dir, '0002.the-epic.card.md'), '---\nid: 2\nstatus: todo\npriority: Normal\ntype: epic\n---\n\n# The epic\n');
  fs.writeFileSync(path.join(dir, '0003.the-goal.card.md'), '---\nid: 3\nstatus: todo\npriority: Normal\ntype: goal\n---\n\n# The goal\n');
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  try { return await fn(call); } finally { srv.close(); }
}

const HIERARCHY_BOARD = 'nextId: 10\nhierarchy: [goal, strategy, objective, epic]\ntypes:\n  - name: goal\n    icon: star\n  - name: epic\n    icon: square\n';

test('creating a goal under an epic, against the hierarchy, succeeds and the answer carries no warning', async () => {
  await withBoard(HIERARCHY_BOARD, async (call) => {
    const created = await call('POST', '/api/cards', { title: 'A goal under an epic', type: 'goal', parent: '2' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.parent, '2');
    assert.strictEqual(created.json.type, 'goal');
    assert.deepStrictEqual(Object.keys(created.json).filter((k) => /warn|error|hierarchy/i.test(k)), []);
  });
});

test('moving a goal under an epic, against the hierarchy, succeeds and the answer carries no warning', async () => {
  await withBoard(HIERARCHY_BOARD, async (call) => {
    const moved = await call('PATCH', '/api/cards/3', { parent: '2' });
    assert.strictEqual(moved.status, 200);
    assert.strictEqual(moved.json.parent, '2');
    assert.deepStrictEqual(Object.keys(moved.json).filter((k) => /warn|error|hierarchy/i.test(k)), []);
    const board = await call('GET', '/api/board');
    assert.strictEqual(board.json.active.find((c) => c.id === '3').parent, '2');
    assert.deepStrictEqual(board.json.hierarchy, ['goal', 'strategy', 'objective', 'epic']);
  });
});

test('the counter write that creating a card makes keeps the hierarchy, pills and icon lines of the live config', async () => {
  const config = `${HIERARCHY_BOARD}pills:\n  - next: 'tags:"next-up"'\n  - "assignee:@human"\n`;
  const dir = tmpBoard(config);
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/cards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Counter' }) });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), config.replace('nextId: 10', 'nextId: 11'));
  } finally { srv.close(); }
});
