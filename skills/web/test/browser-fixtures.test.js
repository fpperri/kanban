const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { BOARDS, materialize } = require('./browser/boards');

// The browser runner drives three boards. Later tickets assert against what is
// on them, so this file is the contract: every case a scenario relies on must
// be on the board, and removing one fails here, not in a slow browser run.
// Cards and types come through the board's own readers. The config reader does
// not return the hierarchy, pills or icons yet, so those three keys are read
// from the config text by the small readers at the bottom of this file; when
// the reader carries them, those checks move onto it.

const tmpRoots = [];
const load = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-fixture-${key}-`));
  tmpRoots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const cards = [...listActive(dir), ...listArchived(dir)];
  const text = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  return { dir, cards, text, config: readConfig(dir), byId: new Map(cards.map((c) => [c.id, c])) };
};
after(() => { for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true }); });

const SNAPSHOT_BODY_CAP = 4000;
const SNAPSHOT_ARCHIVED_BODY_CAP = 1500;
const ICON_NAMES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star'];

function topLevelBlock(text, key) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at === -1) return null;
  const head = lines[at].replace(new RegExp(`^${key}:\\s*`), '');
  const body = [];
  for (let i = at + 1; i < lines.length && (/^\s/.test(lines[i]) || lines[i] === '' || /^-/.test(lines[i])); i++) body.push(lines[i]);
  return { head, body };
}

// A list of plain names, in flow or block form, as written (blank entries stay).
function nameList(text, key) {
  const block = topLevelBlock(text, key);
  if (!block) return null;
  const flow = /^\[(.*)\]/.exec(block.head);
  if (flow) return flow[1].split(',').map((s) => s.trim());
  return block.body.filter((l) => /^\s+-/.test(l)).map((l) => l.replace(/^\s+-\s*/, '').replace(/\s+#.*$/, '').trim());
}

// Raw pill entries from the block form: the text after each dash.
function pillEntries(text) {
  const block = topLevelBlock(text, 'pills');
  return block ? block.body.filter((l) => /^\s+-/.test(l)).map((l) => l.replace(/^\s+-\s*/, '').trim()) : null;
}

// The `types:` block as [{ name, icon }] with the icon text exactly as written.
function typeEntries(text) {
  const block = topLevelBlock(text, 'types');
  const out = [];
  let cur = null;
  for (const l of block ? block.body : []) {
    const start = /^\s+-\s+name:\s*(.*)$/.exec(l);
    const icon = /^\s+icon:\s*(.*?)\s*$/.exec(l);
    if (start) { cur = { name: start[1].trim(), icon: null }; out.push(cur); } else if (icon && cur) cur.icon = icon[1];
  }
  return out;
}

const childrenOf = (cards, id) => cards.filter((c) => c.parent === id);
const isLoose = (cards, c) => c.parent === null && childrenOf(cards, c.id).length === 0;
const yearOf = (c) => [c.start_date, c.end_date, c.due_date].filter(Boolean).map((d) => d.slice(0, 4));

test('every board answers to its own name, with unique card ids and a counter past the last one', () => {
  for (const key of Object.keys(BOARDS)) {
    const b = load(key);
    assert.strictEqual(b.config.name, BOARDS[key].name, `${key}: config name`);
    const ids = b.cards.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${key}: duplicate card id`);
    assert.ok(b.cards.every((c) => !c.unparseable), `${key}: a card file did not parse`);
    assert.ok(b.config.nextId > Math.max(...ids), `${key}: nextId ${b.config.nextId} is not past ${Math.max(...ids)}`);
  }
});

test('the fixture board stays the board with no hierarchy, no pills and no icons', () => {
  const b = load('fixture');
  assert.strictEqual(nameList(b.text, 'hierarchy'), null);
  assert.strictEqual(pillEntries(b.text), null);
  assert.deepStrictEqual(typeEntries(b.text), []);
  assert.ok(b.cards.every((c) => c.type === null), 'a fixture card has a type');
  assert.strictEqual(b.cards.length, 21);
});

test('bodies stay under the snapshot caps on every board', () => {
  for (const key of Object.keys(BOARDS)) {
    for (const c of load(key).cards) {
      const cap = c.archived ? SNAPSHOT_ARCHIVED_BODY_CAP : SNAPSHOT_BODY_CAP;
      assert.ok(c._rawBody.length < cap, `${key} card ${c.id}: body is ${c._rawBody.length} chars, cap ${cap}`);
    }
  }
});

test('plan board config: a four-tier hierarchy, and story, task and bug types outside it', () => {
  const b = load('plan');
  const hierarchy = nameList(b.text, 'hierarchy');
  assert.deepStrictEqual(hierarchy, ['goal', 'strategy', 'objective', 'epic']);
  const types = b.config.types.map((t) => t.name);
  for (const t of hierarchy) assert.ok(types.includes(t), `${t} is not a declared type`);
  for (const t of ['story', 'task', 'bug']) {
    assert.ok(types.includes(t), `${t} is not a declared type`);
    assert.ok(!hierarchy.includes(t), `${t} is inside the hierarchy`);
  }
});

test('plan board config: type icons, one of them an unknown name', () => {
  const b = load('plan');
  const icons = typeEntries(b.text).filter((t) => t.icon);
  assert.ok(icons.length >= 6, `only ${icons.length} types carry an icon`);
  const known = icons.filter((t) => ICON_NAMES.includes(t.icon));
  const unknown = icons.filter((t) => !ICON_NAMES.includes(t.icon));
  assert.deepStrictEqual(known.map((t) => t.icon).sort(), [...ICON_NAMES].sort(), 'each of the six icons is on one type');
  assert.strictEqual(unknown.length, 1, 'exactly one icon name is unknown');
});

test('plan board config: a labelled pill, a plain query pill and a tags:* pill', () => {
  const pills = pillEntries(load('plan').text);
  assert.ok(pills.some((p) => /^[A-Za-z][\w-]*:\s+['"].*['"]$/.test(p)), `no labelled pill in ${JSON.stringify(pills)}`);
  assert.ok(pills.some((p) => /^['"]assignee:@human['"]$/.test(p)), 'no plain query pill');
  assert.ok(pills.some((p) => /^['"]tags:\*['"]$/.test(p)), 'no tags:* pill');
});

test('plan board nesting: a chain from tier 1 down to a task', () => {
  const b = load('plan');
  const task = b.cards.find((c) => c.type === 'task' && c.parent !== null && b.byId.get(c.parent).type === 'story');
  assert.ok(task, 'no task under a story');
  const upward = [];
  for (let c = task; c; c = c.parent === null ? null : b.byId.get(c.parent)) upward.push(c.type);
  assert.deepStrictEqual(upward, ['task', 'story', 'epic', 'objective', 'strategy', 'goal']);
});

test('plan board nesting: a tier-1 card nested under the lowest tier', () => {
  const b = load('plan');
  const hierarchy = nameList(b.text, 'hierarchy');
  const odd = b.cards.filter((c) => c.type === hierarchy[0] && c.parent !== null && b.byId.get(c.parent).type === hierarchy[hierarchy.length - 1]);
  assert.strictEqual(odd.length, 1);
});

test('plan board nesting: a loose card with a tier, and loose cards without one in several statuses', () => {
  const b = load('plan');
  const hierarchy = nameList(b.text, 'hierarchy');
  const active = b.cards.filter((c) => !c.archived);
  const looseTiered = active.filter((c) => isLoose(b.cards, c) && hierarchy.includes(c.type));
  assert.strictEqual(looseTiered.length, 1);
  const looseUntiered = active.filter((c) => isLoose(b.cards, c) && !hierarchy.includes(c.type));
  assert.deepStrictEqual([...new Set(looseUntiered.map((c) => c.status))].sort(), ['backlog', 'doing', 'done', 'todo']);
  assert.ok(looseUntiered.some((c) => c.type === null), 'no loose card without a type');
  assert.ok(looseUntiered.some((c) => ['story', 'task', 'bug'].includes(c.type)), 'no loose card of a type outside the hierarchy');
});

test('plan board nesting: an archived card under an active parent and an archived loose card without a tier', () => {
  const b = load('plan');
  const hierarchy = nameList(b.text, 'hierarchy');
  assert.ok(b.cards.some((c) => c.archived && c.parent !== null && !b.byId.get(c.parent).archived));
  assert.ok(b.cards.some((c) => c.archived && isLoose(b.cards, c) && !hierarchy.includes(c.type)));
});

test('plan board fields: ten distinct tags, and no stray tag that contains ui, grill or next-up', () => {
  const b = load('plan');
  const tags = [...new Set(b.cards.flatMap((c) => c.tags))];
  assert.strictEqual(tags.length, 10, JSON.stringify(tags));
  for (const t of ['next-up', 'grill', 'grilling', 'ui']) assert.ok(tags.includes(t), `missing tag ${t}`);
  const holding = (s) => tags.filter((t) => t.toLowerCase().includes(s)).sort();
  assert.deepStrictEqual(holding('ui'), ['ui']);
  assert.deepStrictEqual(holding('grill'), ['grill', 'grilling']);
  assert.deepStrictEqual(holding('next-up'), ['next-up']);
});

test('plan board fields: assignees @human and @afk, a blocked card and a review card', () => {
  const b = load('plan');
  const assignees = new Set(b.cards.map((c) => c.assignee));
  assert.ok(assignees.has('@human') && assignees.has('@afk'), JSON.stringify([...assignees]));
  assert.ok(b.cards.some((c) => c.blocked), 'no blocked card');
  assert.ok(b.cards.some((c) => c.review), 'no review card');
});

test('plan board fields: a done card that others wait for, and a dangling waiting id', () => {
  const b = load('plan');
  const waited = b.cards.filter((c) => c.status === 'done' && b.cards.filter((o) => o.waiting_for.includes(c.id)).length >= 2);
  assert.ok(waited.length >= 1, 'no done card with two cards waiting for it');
  assert.ok(b.cards.some((c) => c.waiting_for.some((id) => !b.byId.has(id))), 'no dangling waiting id');
  assert.ok(b.cards.some((c) => c.waiting_for.length && c.waiting_for.every((id) => b.byId.has(id) && b.byId.get(id).status === 'done')), 'no card that waits only for done cards');
});

test('plan board fields: cards dated in 2020 and 2031, the 2031 one alone', () => {
  const b = load('plan');
  assert.ok(b.cards.some((c) => yearOf(c).includes('2020')));
  assert.strictEqual(b.cards.filter((c) => yearOf(c).includes('2031')).length, 1);
});

test('malformed board: a hierarchy with mixed-case duplicate names and a blank entry', () => {
  const hierarchy = nameList(load('malformed').text, 'hierarchy');
  assert.ok(hierarchy.includes(''), 'no blank entry');
  const named = hierarchy.filter(Boolean);
  const lower = named.map((n) => n.toLowerCase());
  assert.ok(lower.some((n, i) => lower.indexOf(n) !== i), 'no duplicate name');
  const pair = named.find((n, i) => named.some((m, j) => j !== i && m !== n && m.toLowerCase() === n.toLowerCase()));
  assert.ok(pair, 'no duplicate that differs only in case');
});

test('malformed board: an empty pill, a "- tags: grill" pill and an unknown icon name', () => {
  const b = load('malformed');
  const pills = pillEntries(b.text);
  assert.ok(pills.includes(''), `no empty pill in ${JSON.stringify(pills)}`);
  assert.ok(pills.includes('tags: grill'), 'no "- tags: grill" pill');
  const icons = typeEntries(b.text).map((t) => t.icon).filter(Boolean);
  assert.ok(icons.some((i) => !ICON_NAMES.includes(i)), `no unknown icon in ${JSON.stringify(icons)}`);
});

test('malformed board: the board readers load it and its views have cards to draw', () => {
  const b = load('malformed');
  assert.ok(b.cards.length >= 4);
  assert.ok(b.cards.some((c) => c.parent !== null), 'no nested card');
  assert.ok(b.cards.some((c) => c.start_date || c.due_date), 'no dated card for the Calendar and Gantt');
});

test('materializing a board again puts it back as it was, and keeps the folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-fixture-again-'));
  tmpRoots.push(root);
  const dir = path.join(root, 'board');
  const listing = () => fs.readdirSync(dir, { recursive: true }).sort();
  materialize('plan', dir, { port: 7123 });
  const before = listing();
  const config = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  assert.ok(/^port: 7123\r?\n/.test(config), 'the port is the first line');
  fs.writeFileSync(path.join(dir, '0001.zephyr-platform-migration.card.md'), 'edited');
  fs.writeFileSync(path.join(dir, 'stray.txt'), 'left by a scenario');
  fs.rmSync(path.join(dir, 'archived'), { recursive: true });
  materialize('plan', dir, { port: 7123 });
  assert.deepStrictEqual(listing(), before);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), config);
  assert.ok(fs.readFileSync(path.join(dir, '0001.zephyr-platform-migration.card.md'), 'utf8').includes('type: goal'));
});

test('an unknown board is refused and the known ones are listed', () => {
  assert.throws(() => materialize('nope', os.tmpdir()), /unknown board 'nope': fixture, plan, malformed/);
});
