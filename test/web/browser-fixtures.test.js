const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived } = require('../../plugin/skills/web/scripts/card-store');
const { readConfig, ICON_NAMES } = require('../../plugin/skills/web/scripts/config-store');
const { listNotes } = require('../../plugin/skills/web/scripts/logbook-store');
const { readPad, listTargets } = require('../../plugin/skills/web/scripts/scratchpad-store');
const todoStore = require('../../plugin/skills/web/scripts/todo-store');
const { readGroups } = require('../../plugin/skills/web/scripts/group-store');
const { BOARDS, materialize } = require('./browser/boards');

// The browser runner drives three boards. The scenarios assert against what is
// on them, so this file is the contract: every case a scenario relies on must
// be on the board, and removing one fails here, not in a slow browser run.
// Cards and config come through the board's own readers, the hierarchy, pills
// and type icons included. The reader skips a broken entry without a word, so
// the malformed board's checks also read the entries as written (rawEntries) to
// prove the breakage is really in the file.

const tmpRoots = [];
const load = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-fixture-${key}-`));
  tmpRoots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const cards = [...listActive(dir), ...listArchived(dir)];
  const text = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  return { dir, cards, text, config: readConfig(dir), byId: new Map(cards.map((c) => [String(c.id), c])) };
};
after(() => { for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true }); });

const SNAPSHOT_BODY_CAP = 4000;
const SNAPSHOT_ARCHIVED_BODY_CAP = 1500;

// The text after each dash of a top-level block list, exactly as written, or
// null when the key is absent. Only the malformed board's checks use it.
function rawEntries(text, key) {
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < lines.length && (/^\s/.test(lines[i]) || lines[i] === ''); i++) {
    if (/^\s+-/.test(lines[i])) out.push(lines[i].replace(/^\s+-\s*/, '').trim());
  }
  return out;
}

const childrenOf = (cards, id) => cards.filter((c) => c.parent === String(id));
const isLoose = (cards, c) => c.parent === null && childrenOf(cards, c.id).length === 0;
const yearOf = (c) => [c.start_date, c.end_date, c.due_date].filter(Boolean).map((d) => d.slice(0, 4));

test('every board answers to its own name, with unique card ids and a counter past the last plain one', () => {
  for (const key of Object.keys(BOARDS)) {
    const b = load(key);
    assert.strictEqual(b.config.name, BOARDS[key].name, `${key}: config name`);
    const ids = b.cards.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${key}: duplicate card id`);
    assert.ok(b.cards.every((c) => !c.unparseable), `${key}: a card file did not parse`);
    const plain = ids.filter((id) => /^\d+$/.test(id)).map(Number);
    assert.ok(b.config.nextId > Math.max(...plain), `${key}: nextId ${b.config.nextId} is not past ${Math.max(...plain)}`);
  }
});

test('the fixture board stays the board with no hierarchy, no pills and no icons', () => {
  const b = load('fixture');
  assert.deepStrictEqual(b.config.hierarchy, []);
  assert.deepStrictEqual(b.config.pills, []);
  assert.deepStrictEqual(b.config.types, []);
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

test('markdown board: the fixture board plus card 22, whose body holds the constructs the markdown scenario reads, and cards 23 and 24 with a good and a bad diagram', () => {
  const b = load('markdown');
  assert.strictEqual(b.cards.length, 24);
  assert.match(b.byId.get('23')._rawBody, /```mermaid\ngraph TD/);
  assert.match(b.byId.get('24')._rawBody, /```mermaid\nthis is not a diagram\n```\n\nStill here after it\./);
  assert.ok(!/```mermaid/.test(b.byId.get('22')._rawBody) && !/```mermaid/.test(b.byId.get('1')._rawBody));
  const body = b.byId.get('22')._rawBody;
  for (const marker of ['#### ', '**bold**', '~~struck~~', '<u>underlined</u>', 'https://example.test/docs', '1. first', '   - a bullet under a number', '> quoted words', '> - and a quoted bullet', '```c#', '````', '<details>', '<summary>Open me</summary>']) {
    assert.ok(body.includes(marker), `card 22 holds ${marker}`);
  }
});

test('plan board config: a four-tier hierarchy, and story, task and bug types outside it', () => {
  const b = load('plan');
  const hierarchy = b.config.hierarchy;
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
  const icons = b.config.types.filter((t) => t.icon);
  assert.ok(icons.length >= 6, `only ${icons.length} types carry an icon`);
  assert.ok(b.config.types.every((t) => t.icon === undefined || typeof t.icon === 'string'));
  const known = icons.filter((t) => ICON_NAMES.includes(t.icon));
  const unknown = icons.filter((t) => !ICON_NAMES.includes(t.icon));
  assert.deepStrictEqual(known.map((t) => t.icon).sort(), [...ICON_NAMES].sort(), 'each of the six icons is on one type');
  assert.strictEqual(unknown.length, 1, 'exactly one icon name is unknown');
});

test('plan board config: a labelled pill, a plain query pill and a tags:* pill', () => {
  assert.deepStrictEqual(load('plan').config.pills, [
    { label: 'next', query: 'tags:"next-up"' },
    { label: 'assignee:@human', query: 'assignee:@human' },
    { label: 'tags:*', query: 'tags:*' },
  ]);
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
  const hierarchy = b.config.hierarchy;
  const odd = b.cards.filter((c) => c.type === hierarchy[0] && c.parent !== null && b.byId.get(c.parent).type === hierarchy[hierarchy.length - 1]);
  assert.strictEqual(odd.length, 1);
});

test('plan board nesting: a loose card with a tier, and loose cards without one in several statuses', () => {
  const b = load('plan');
  const hierarchy = b.config.hierarchy;
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
  const hierarchy = b.config.hierarchy;
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
  assert.ok(b.cards.some((c) => c.waiting_for.some((id) => !b.byId.has(String(id)))), 'no dangling waiting id');
  assert.ok(b.cards.some((c) => c.waiting_for.length && c.waiting_for.every((id) => b.byId.has(String(id)) && b.byId.get(String(id)).status === 'done')), 'no card that waits only for done cards');
});

test('plan board fields: cards dated in 2020 and 2031, the 2031 one alone', () => {
  const b = load('plan');
  assert.ok(b.cards.some((c) => yearOf(c).includes('2020')));
  assert.strictEqual(b.cards.filter((c) => yearOf(c).includes('2031')).length, 1);
});

test('malformed board: a hierarchy with mixed-case duplicate names and a blank entry', () => {
  const b = load('malformed');
  assert.ok(rawEntries(b.text, 'hierarchy').includes(''), 'no blank entry in the file');
  const hierarchy = b.config.hierarchy;
  assert.deepStrictEqual(hierarchy, ['Goal', 'goal', 'Epic', 'EPIC'], 'the reader drops the blank and keeps the rest as written');
  const lower = hierarchy.map((n) => n.toLowerCase());
  assert.ok(lower.some((n, i) => lower.indexOf(n) !== i), 'no duplicate name');
  const pair = hierarchy.find((n, i) => hierarchy.some((m, j) => j !== i && m !== n && m.toLowerCase() === n.toLowerCase()));
  assert.ok(pair, 'no duplicate that differs only in case');
});

test('malformed board: an empty pill, a "- tags: grill" pill and an unknown icon name', () => {
  const b = load('malformed');
  const raw = rawEntries(b.text, 'pills');
  assert.ok(raw.includes(''), `no empty pill in ${JSON.stringify(raw)}`);
  assert.ok(raw.includes('tags: grill'), 'no "- tags: grill" pill');
  assert.deepStrictEqual(b.config.pills, [
    { label: 'tags', query: 'grill' },
    { label: 'assignee:@human', query: 'assignee:@human' },
  ]);
  const icons = b.config.types.map((t) => t.icon).filter(Boolean);
  assert.ok(icons.some((i) => !ICON_NAMES.includes(i)), `no unknown icon in ${JSON.stringify(icons)}`);
});

test('malformed board: the board readers load it and its views have cards to draw', () => {
  const b = load('malformed');
  assert.ok(b.cards.length >= 4);
  assert.ok(b.cards.some((c) => c.parent !== null), 'no nested card');
  assert.ok(b.cards.some((c) => c.start_date || c.due_date), 'no dated card for the Calendar and Gantt');
});

test('notes board: the plan board with a logbook, day files for cards 3, 7 and 22 and for nothing', () => {
  const b = load('notes');
  const plan = load('plan');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), plan.cards.map((c) => c.id).sort(), 'the same cards as the plan board');
  assert.strictEqual(b.config.logbook, 'logbook');
  assert.strictEqual(plan.config.logbook, '', 'the plan board keeps no logbook');
  const notes = listNotes(b.dir).map((n) => `${n.day} ${n.target || '-'} ${n.at || 'untimed'} ${n.by}`).sort();
  assert.deepStrictEqual(notes, [
    '2026-10-13 3 11:15 @afk',
    '2026-10-14 7 untimed @human',
    '2026-10-15 - 08:00 @human',
    '2026-10-15 22 10:00 @human',
    '2026-10-15 7 09:30 @human',
    '2026-10-15 7 14:10 @afk',
  ]);
  const hand = fs.readFileSync(path.join(b.dir, 'logbook', '2026.10.13.0003.logbook.md'), 'utf8');
  assert.match(hand, /^title: Monday$/m, 'a frontmatter key of its own');
  assert.match(hand, /^ {4}run: build-12$/m, 'an entry key of its own');
  assert.match(hand, /Hand-written text below/, 'a body');
});

test('groups board: the plan board with groups in folders, prefixes for them, and a logbook note on a group', () => {
  const b = load('groups');
  const plan = load('plan');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), plan.cards.map((c) => c.id).sort(), 'the same cards as the plan board');
  assert.strictEqual(b.config.groups, '.groups');
  assert.strictEqual(plan.config.groups, '', 'the plan board keeps no groups');
  assert.deepStrictEqual(b.config.prefixes, { G: 'goal', _: '.groups', I: '.groups/iteration', W: '.groups/workflow', DW: '.groups/workflow/dynamic' });
  const read = readGroups(b.dir);
  const by = Object.fromEntries(read.list.map((g) => [g.id, g]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['DW1', 'I1', 'I2', 'W1', '_1']);
  assert.deepStrictEqual([by._1.folder, by.I2.folder, by.W1.folder, by.DW1.folder], ['', 'iteration', 'workflow', 'workflow/dynamic']);
  assert.deepStrictEqual(by.I2.cards, ['3', '7', '15', '22', '23', '24']);
  assert.deepStrictEqual(by.I2.extra, { owner: '@human' });
  assert.ok(by.I2.auto_join && by.I2.start_date && by.I2.end_date, 'a running iteration shape');
  assert.ok(!by.W1.auto_join && !by.W1.start_date, 'an undated workflow');
  const holders = (id) => read.list.filter((g) => g.cards.includes(id)).map((g) => g.id);
  assert.deepStrictEqual(holders('7'), ['DW1', 'I2', 'W1'], 'one card in three groups: two badges and +1');
  assert.deepStrictEqual(holders('3'), ['I2'], 'one badge');
  assert.deepStrictEqual(holders('1'), [], 'no badge');
  assert.deepStrictEqual(read.skipped.map((s) => s.file), ['.groups/a/b/c/X0001.too-deep.md'], 'a file nested too deep is reported');
  assert.deepStrictEqual(listNotes(b.dir).map((n) => `${n.day} ${n.target}`), ['2026-10-15 I2']);
});

test('groupsonly board: the groups board with the logbook line taken out', () => {
  const b = load('groupsonly');
  const groups = load('groups');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), groups.cards.map((c) => c.id).sort(), 'the same cards as the groups board');
  assert.strictEqual(b.config.groups, '.groups');
  assert.strictEqual(b.config.logbook, '', 'no logbook line');
  assert.deepStrictEqual(readGroups(b.dir).list.map((g) => g.id).sort(), ['DW1', 'I1', 'I2', 'W1', '_1']);
});

test('iterations board: the groups board with iterations: true, which is the only difference', () => {
  const b = load('iterations');
  const groups = load('groups');
  assert.strictEqual(b.config.iterations, true);
  assert.strictEqual(groups.config.iterations, false, 'the groups board has no iterations line');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), groups.cards.map((c) => c.id).sort(), 'the same cards as the groups board');
  assert.deepStrictEqual(readGroups(b.dir).list.map((g) => g.id).sort(), ['DW1', 'I1', 'I2', 'W1', '_1']);
  assert.strictEqual(b.config.groups, '.groups');
  assert.strictEqual(b.config.name, 'iterations', 'its own name, so its saved choices have their own keys');
});

test('scratchpad board: the groups board with a scratchpad: line, a page for card 7 with three refs and one for group I2', () => {
  const b = load('scratchpad');
  const groups = load('groups');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), groups.cards.map((c) => c.id).sort(), 'the same cards as the groups board');
  assert.strictEqual(b.config.scratchpad, '.scratchpad');
  assert.strictEqual(b.config.logbook, 'logbook', 'the logbook stays on');
  assert.strictEqual(groups.config.scratchpad, '', 'the groups board has no scratchpad line');
  assert.deepStrictEqual(listTargets(b.dir), ['7', 'I2']);
  const pad = readPad(b.dir, '7');
  assert.deepStrictEqual(pad.refs, ['src/orders/schema.js', '2026.10.15.I0002.logbook.md', '#3']);
  assert.match(pad.body, /^check the enum renames\n- orders\.status/);
  assert.strictEqual(readPad(b.dir, 'I2').body, 'ask ops about the freeze window\n');
  assert.strictEqual(b.config.name, 'scratchpad');
});

test('todos board: the scratchpad board with todos: naming the scratchpad\'s own folder, a list for card 7 beside its page and one for group I2', () => {
  const b = load('todos');
  const pads = load('scratchpad');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), pads.cards.map((c) => c.id).sort(), 'the same cards as the scratchpad board');
  assert.strictEqual(b.config.todos, '.scratchpad');
  assert.strictEqual(b.config.scratchpad, '.scratchpad', 'both name one folder');
  assert.strictEqual(b.config.logbook, 'logbook');
  assert.strictEqual(pads.config.todos, '', 'the scratchpad board has no todos line');
  assert.strictEqual(b.config.name, 'todos');
  assert.deepStrictEqual(todoStore.listTargets(b.dir), ['7', 'I2']);
  assert.deepStrictEqual(listTargets(b.dir), ['7', 'I2'], 'and each store lists only its own kind of file');
  assert.deepStrictEqual(todoStore.counts(b.dir), { 7: { open: 3, total: 4 }, I2: { open: 1, total: 1 } });
  const list = todoStore.readTodos(b.dir, '7');
  assert.deepStrictEqual(list.lines.map((l) => (l.item ? `${l.depth}${l.done ? 'x' : 'o'} ${l.text}` : `= ${l.text}`)), ['= # Before the handoff', '0o check the enum renames', '0x run the migration dry run', '0o update the changelog', '1o note the breaking rename']);
  assert.strictEqual(readPad(b.dir, '7').body.startsWith('check the enum renames'), true, 'the scratchpad page beside it is the same');
});

test('scratchonly board: the groups board with scratchpads on and the logbook off, and no page written yet', () => {
  const b = load('scratchonly');
  const groups = load('groups');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), groups.cards.map((c) => c.id).sort(), 'the same cards as the groups board');
  assert.strictEqual(b.config.scratchpad, '.scratchpad');
  assert.strictEqual(b.config.logbook, '');
  assert.strictEqual(b.config.groups, '.groups');
  assert.deepStrictEqual(listTargets(b.dir), []);
  assert.strictEqual(b.config.name, 'scratchonly');
});

test('feature board: every part of the notes and groups feature on one board, with a prefixed card in a running iteration', () => {
  const b = load('feature');
  const groups = load('groups');
  const cfg = b.config;
  assert.strictEqual(cfg.name, 'feature');
  assert.strictEqual(cfg.logbook, 'logbook');
  assert.strictEqual(cfg.scratchpad, '.scratchpad');
  assert.strictEqual(cfg.groups, '.groups');
  assert.strictEqual(cfg.iterations, true);
  assert.deepStrictEqual(cfg.prefixes, { G: 'goal', _: '.groups', I: '.groups/iteration', W: '.groups/workflow', DW: '.groups/workflow/dynamic' });
  assert.deepStrictEqual(cfg.prefixClashes, [], 'no prefix declared twice');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), [...groups.cards.map((c) => c.id), 'G11'].sort(), 'the groups board and one goal with a prefixed id');
  assert.ok(b.byId.has('11') && b.byId.has('G11'), '#11 and #G11 are two cards');
  assert.strictEqual(b.byId.get('G11').type, 'goal');
  assert.ok(cfg.counters.G > 11, 'the goal counter is past the goal on the board');
  const read = readGroups(b.dir);
  assert.deepStrictEqual(read.list.map((g) => g.id).sort(), ['DW1', 'I1', 'I2', 'W1', '_1'], 'typed groups, an untyped one and two iterations');
  const i2 = read.list.find((g) => g.id === 'I2');
  assert.ok(i2.auto_join && i2.start_date && i2.end_date, 'an iteration that auto-joins');
  assert.deepStrictEqual(i2.cards, ['3', '7', '15', '22', '23', '24', 'G11'], 'the prefixed card is in the iteration');
  assert.deepStrictEqual(listNotes(b.dir).map((n) => `${n.day} ${n.target}`), ['2026-10-15 I2'], 'a logbook with one note, on a group');
  assert.deepStrictEqual(listTargets(b.dir), ['7', 'I2'], 'a scratchpad with a page for a card and one for a group');
});

test('calnotes board: the notes board and two more notes, one half hour with two notes and a day with two untimed', () => {
  const b = load('calnotes');
  const notes = new Map();
  for (const n of listNotes(b.dir)) notes.set(`${n.day} ${n.target || '-'} ${n.at || 'untimed'}`, n);
  const base = load('notes');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), base.cards.map((c) => c.id).sort(), 'the same cards as the notes board');
  assert.strictEqual(listNotes(b.dir).length, listNotes(base.dir).length + 2);
  assert.ok(notes.has('2026-10-15 22 10:00') && notes.has('2026-10-15 3 10:10'), 'two notes in the half hour from 10:00 on the 15th');
  assert.ok(notes.has('2026-10-14 7 untimed') && notes.has('2026-10-14 3 untimed'), 'two untimed notes on the 14th');
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

test('iterlog board: the groups board whose logbook and scratchpad paths name the iteration, with card 7 in the iteration I2', () => {
  const b = load('iterlog');
  const groups = load('groups');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), groups.cards.map((c) => c.id).sort(), 'the same cards as the groups board');
  assert.strictEqual(b.config.name, 'iterlog');
  assert.strictEqual(b.config.logbook, 'logbook/<iteration>');
  assert.strictEqual(b.config.scratchpad, '.pads/<iteration>');
  assert.strictEqual(b.config.groups, '.groups');
  const i2 = readGroups(b.dir).list.find((g) => g.id === 'I2');
  assert.deepStrictEqual([i2.start_date, i2.end_date], ['2026-10-12', '2026-10-23']);
  assert.ok(i2.cards.includes('7'));
  assert.deepStrictEqual(listNotes(b.dir).map((n) => `${n.day} ${n.target}`), ['2026-10-15 I2'], 'the group note sits in the folder with the segment dropped');
  assert.deepStrictEqual(listTargets(b.dir), []);
});

test('padfolder board: the fixture board whose scratchpad path holds <card>, with card 7\'s own folder', () => {
  const b = load('padfolder');
  const fixture = load('fixture');
  assert.deepStrictEqual(b.cards.map((c) => c.id).sort(), fixture.cards.map((c) => c.id).sort(), 'the same cards as the fixture board');
  assert.strictEqual(b.config.name, 'padfolder');
  assert.strictEqual(b.config.scratchpad, '.pads/<card>');
  const folder = path.join(b.dir, '.pads', '0007.port-the-zephyr-schema');
  assert.deepStrictEqual(fs.readdirSync(folder).sort(), ['0007.scratchpad.md', 'blob.bin', 'build.log', 'notes.txt', 'plan.md', 'shot.png', 'sub']);
  assert.deepStrictEqual(fs.readdirSync(path.join(folder, 'sub')), ['deep.txt']);
  assert.ok(/!\[the shot\]\(shot\.png\)/.test(fs.readFileSync(path.join(folder, 'plan.md'), 'utf8')), 'plan.md holds a picture beside it');
  assert.deepStrictEqual(listTargets(b.dir), ['7']);
});
