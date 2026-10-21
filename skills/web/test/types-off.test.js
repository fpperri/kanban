const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');
const { typeBadge, boardTypeView } = require('../web/type-badge');
const { sliceCards } = require('../web/slices');
const { depthMap } = require('../web/nesting');
const { graphBuild } = require('../web/graph-model');
const { card } = require('./helpers/fan-boards');

// Types off (typesOn: false, docs/adr/0018): the views ignore the board's types. One gate hands them
// an empty types list and no hierarchy (boardTypeView, read in applyBoardData); the chips take the
// flag as well, because a chip with no listed type is still a neutral chip.

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

const TYPES = [{ name: 'goal', color: '#a371f7', icon: 'diamond' }, { name: 'epic', color: '' }];
const HIERARCHY = ['goal', 'epic'];

test('typeBadge draws nothing for a typed card when types are off, and the same chip as before when on or unsaid', () => {
  const c = { type: 'goal' };
  assert.strictEqual(typeBadge(c, TYPES, false), '');
  assert.strictEqual(typeBadge(c, [], false), '');
  const chip = typeBadge(c, TYPES);
  assert.match(chip, /^<span class="type-chip"/);
  assert.strictEqual(typeBadge(c, TYPES, true), chip);
  assert.strictEqual(typeBadge(c, TYPES, undefined), chip);
});

test('the gate hands the views the board\'s lists as they are when types are on or the payload says nothing', () => {
  for (const data of [{ types: TYPES, hierarchy: HIERARCHY }, { typesOn: true, types: TYPES, hierarchy: HIERARCHY }]) {
    assert.deepStrictEqual(boardTypeView(data), { typesOn: true, types: TYPES, hierarchy: HIERARCHY });
  }
  assert.deepStrictEqual(boardTypeView({}), { typesOn: true, types: [], hierarchy: [] }, 'an old server without the fields');
});

test('the gate hands the views an empty types list and no hierarchy when types are off', () => {
  assert.deepStrictEqual(boardTypeView({ typesOn: false, types: TYPES, hierarchy: HIERARCHY }), { typesOn: false, types: [], hierarchy: [] });
});

test('turning types back on shows the lists again, with no change to the payload\'s data', () => {
  const data = { typesOn: false, types: TYPES, hierarchy: HIERARCHY };
  boardTypeView(data);
  assert.deepStrictEqual(data.types, TYPES);
  assert.deepStrictEqual(boardTypeView(Object.assign({}, data, { typesOn: true })).hierarchy, HIERARCHY);
});

const cards = [
  card(1, { type: 'goal' }),
  card(2, { type: 'epic', parent: 1 }),
  card(3, { parent: 2 }),
  card(4),
];
const ctx = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

test('with types off the slices are the depths, exactly as on a board with no hierarchy', () => {
  const off = boardTypeView({ typesOn: false, types: TYPES, hierarchy: HIERARCHY });
  const depths = depthMap(cards, ctx);
  const axis = sliceCards(cards, off.hierarchy, depths);
  assert.deepStrictEqual(axis.axis.map((s) => s.kind), ['depth', 'depth', 'depth']);
  assert.deepStrictEqual(axis, sliceCards(cards, [], depths));
  const on = sliceCards(cards, HIERARCHY, depths);
  assert.deepStrictEqual(on.axis.slice(0, 2).map((s) => s.kind), ['tier', 'tier'], 'on, the same cards sit in tiers');
});

test('with types off the Graph places every card by depth and draws every node as a circle', () => {
  const off = boardTypeView({ typesOn: false, types: TYPES, hierarchy: HIERARCHY });
  const none = graphBuild(cards, { ctx, hierarchy: [], types: [] });
  const model = graphBuild(cards, { ctx, hierarchy: off.hierarchy, types: off.types });
  assert.deepStrictEqual(model, none);
  assert.deepStrictEqual(model.nodes.map((n) => n.shape), ['circle', 'circle', 'circle', 'circle']);
  const on = graphBuild(cards, { ctx, hierarchy: HIERARCHY, types: TYPES });
  assert.strictEqual(on.nodes.find((n) => n.id === '1').shape, 'diamond');
});

test('applyBoardData reads the lists through the gate and keeps the flag for the chips and the form', () => {
  const body = appSrc.match(/function applyBoardData\(data\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(body, /const view = boardTypeView\(data\);/);
  assert.match(body, /state\.typesOn = view\.typesOn;/);
  assert.match(body, /state\.types = view\.types;/);
  assert.match(body, /state\.hierarchy = view\.hierarchy;/);
  assert.doesNotMatch(body, /data\.types|data\.hierarchy/, 'nothing reads the lists past the gate');
});

test('every chip the page draws takes the flag', () => {
  const draws = appSrc.match(/typeBadge\([^\n]*?\)\}?/g) || [];
  const chips = draws.filter((d) => /state\.types/.test(d) && !/type: plain/.test(d)); // the detail's line is gated by its own condition
  assert.strictEqual(chips.length, 3, 'tiles, archive tiles and the Map rich rows');
  for (const d of chips) assert.match(d, /state\.types, state\.typesOn\)/, d);
});

test('the Map\'s rich row reserves no type line when types are off', () => {
  assert.match(appSrc.match(/function mapRichLayout\([\s\S]*?\n\}/)[0], /state\.typesOn !== false/);
});

test('the board payload carries typesOn, true when no line says otherwise and false when it does', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-types-off-'));
  try {
    fs.writeFileSync(path.join(dir, '0001.one.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\ntype: goal\n---\n\n# One\n');
    const srv = createServer(dir);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const board = async () => (await fetch(`${base}/api/board`)).json();
      assert.strictEqual((await board()).typesOn, true);
      fs.writeFileSync(path.join(dir, 'config.yaml'), 'typesOn: false\ntypes: [goal]\nhierarchy: [goal]\n');
      const off = await board();
      assert.strictEqual(off.typesOn, false);
      assert.deepStrictEqual(off.hierarchy, ['goal'], 'the lists stay as written');
      assert.strictEqual(off.active[0].type, 'goal', 'and so does the card\'s type');
    } finally { srv.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a save from the form with types off, which sends no type, leaves the card\'s type line as written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-types-off-'));
  try {
    const file = path.join(dir, '0001.one.card.md');
    fs.writeFileSync(file, '---\nid: 1\nstatus: todo\npriority: Normal\ntype: "user story"\n---\n\n# One\n\nbody\n');
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'typesOn: false\n');
    const srv = createServer(dir);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/cards/1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed', status: 'doing', priority: 'High', tags: [], waiting_for: [], body: 'body\n' }),
      });
      assert.strictEqual(res.status, 200);
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /^type: "user story"$/m);
      assert.match(text, /^status: doing$/m);
    } finally { srv.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
