const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../../web/scripts/config-store');
const { BOARD, withSnapshot } = require('./nesting-fixture');

// The snapshot reads the same config.yaml lists as kanban-web: the card types
// (a name and an optional color each) and the priority order that sorts
// siblings with no rank.

function embeddedConst(html, name) {
  const m = new RegExp(`const ${name}=(.*);\\n`).exec(html);
  assert.ok(m, `const ${name} is in the page`);
  return JSON.parse(m[1]);
}

function typesFor(config) {
  return withSnapshot({ ...BOARD, config }, (html) => embeddedConst(html, 'TYPES'));
}

const FORMS = {
  'block entries with colors': 'name: b\ntypes:\n  - name: objective\n    color: "#a371f7"\n  - name: epic\n    color: orange\n',
  'a quoted color with a trailing comment': 'name: b\ntypes:\n  - name: "two words" # label\n    color: "#a371f7" # purple\n',
  'an escaped quote in a name': 'name: b\ntypes:\n  - name: "say \\"hi\\""\n',
  'a bare hex color': 'name: b\ntypes:\n  - name: objective\n    color: #ff00ff\n  - name: story\n',
  'bare entries': 'name: b\ntypes:\n  - epic\n  - story\n',
  'a mix of block and bare entries, with a trailing comment': 'name: b\ntypes:\n  - name: objective # the big one\n    color: red\n  - story\n  - name: ""\n  - name: task\n',
  'an inline list': 'name: b\ntypes: [objective, "two words", story]\n',
  'an empty inline list': 'name: b\ntypes: []\n',
  'keys after the list': 'name: b\ntypes:\n  - name: epic\n    color: red\nstatuses: [todo, done]\n',
  'a comment after the key': 'name: b\ntypes:   # suggested card types\n  - name: objective\n    color: "#a371f7"\n  - story\n',
  'no types key': 'name: b\nstatuses: [todo, done]\n',
  'a type with no icon beside one with an icon': 'name: b\ntypes:\n  - name: goal\n    color: red\n  - name: epic\n    icon: star\n',
  'a mixed-case icon, bare and quoted': 'name: b\ntypes:\n  - name: a\n    icon: Star\n  - name: b\n    icon: "HEXAGON"\n  - name: c\n    icon: \'Diamond\'\n',
  'an icon with a trailing comment': 'name: b\ntypes:\n  - name: a\n    icon: star   # five points\n  - name: b\n    icon: "square" # four\n',
  'an unknown icon name': 'name: b\ntypes:\n  - name: a\n    icon: Blob\n  - name: b\n    icon: 3d-cube\n',
  'a blank icon, a comment-only icon and an icon written before its name': 'name: b\ntypes:\n  - name: a\n    icon:\n  - name: b\n    icon: ""\n  - name: c\n    icon: # none yet\n  - icon: square\n    name: d\n',
  'an icon on an entry with no name': 'name: b\ntypes:\n  - icon: star\n  - name: epic\n',
  'an icon line under an assignee and under a pill, not under a type': 'name: b\nassignees:\n  - handle: "@human"\n    icon: star\ntypes:\n  - name: goal\npills:\n  - next: x\n    icon: star\n',
  'an inline types list': 'name: b\ntypes: [goal, epic]\n',
};

for (const [label, config] of Object.entries(FORMS)) {
  test(`types: ${label} reads the way kanban-web reads it`, () => {
    assert.deepStrictEqual(typesFor(config), parseConfig(config).types);
  });
}

test('types keep the order they are written in, with color empty when none is given', () => {
  assert.deepStrictEqual(typesFor(FORMS['block entries with colors'] + '  - story\n'), [
    { name: 'objective', color: '#a371f7' },
    { name: 'epic', color: 'orange' },
    { name: 'story', color: '' },
  ]);
});

test('a type carries an icon only when one is set, lowercased and with any trailing comment stripped', () => {
  const config = 'name: b\ntypes:\n  - name: goal\n    color: "#a371f7"\n    icon: Star # the big one\n  - name: epic\n    color: orange\n  - story\n  - name: task\n    icon: "TRIANGLE"\n  - name: bug\n    icon: Blob\n';
  assert.deepStrictEqual(typesFor(config), [
    { name: 'goal', color: '#a371f7', icon: 'star' },
    { name: 'epic', color: 'orange' },
    { name: 'story', color: '' },
    { name: 'task', color: '', icon: 'triangle' },
    { name: 'bug', color: '', icon: 'blob' },
  ]);
});

test('a comment after the types key still opens the list the skill documents', () => {
  const config = 'name: b\ntypes:                  # suggested card types\n  - name: objective\n    color: "#a371f7"\n  - story\n';
  assert.deepStrictEqual(typesFor(config), [{ name: 'objective', color: '#a371f7' }, { name: 'story', color: '' }]);
});

test('a type name or color that looks like markup cannot close the script element', () => {
  withSnapshot({ ...BOARD, config: 'name: b\ntypes:\n  - name: "</script><b>"\n    color: red\n' }, (html) => {
    assert.deepStrictEqual(embeddedConst(html, 'TYPES'), [{ name: '</script><b>', color: 'red' }]);
  });
});

function prioritiesFor(config) {
  return withSnapshot({ ...BOARD, config }, (html) => embeddedConst(html, 'PRIOS'));
}

test('the priority order is the configured one, inline or block', () => {
  assert.deepStrictEqual(prioritiesFor('name: b\npriorities: [Urgent, High, Normal]\n'), ['Urgent', 'High', 'Normal']);
  assert.deepStrictEqual(prioritiesFor('name: b\npriorities:\n  - Urgent\n  - "High"\n'), ['Urgent', 'High']);
});

test('a comment after the priorities key opens the block, and kanban-web reads it the same way', () => {
  const config = 'name: b\npriorities:   # high first\n  - Urgent\n  - Normal\n';
  assert.deepStrictEqual(prioritiesFor(config), ['Urgent', 'Normal']);
  assert.deepStrictEqual(prioritiesFor(config), parseConfig(config).priorities);
});

test('no priorities key leaves the list empty, so the module falls back to High, Normal, Low', () => {
  assert.deepStrictEqual(prioritiesFor('name: b\n'), []);
});

function statusesFor(config) {
  return withSnapshot({ ...BOARD, config }, (html) => embeddedConst(html, 'COLS'));
}

test('the statuses list reads the way kanban-web reads it in every form, and falls back to the built-in four', () => {
  for (const config of [
    'name: b\nstatuses: [todo, done]\n',
    'name: b\nstatuses: [todo, "in review", done] # columns\n',
    'name: b\nstatuses:\n  - todo\n  - "done" # last\n',
    'name: b\nstatuses:   # columns\n  - todo\n  - done\n',
    'name: b\nstatuses: []\nnextId: 4\n',
    'name: b\n',
  ]) {
    const web = parseConfig(config).statuses;
    assert.deepStrictEqual(statusesFor(config), web.length ? web : ['backlog', 'todo', 'doing', 'done'], JSON.stringify(config));
  }
});

// The board's own pills: each entry of `pills:` is a query, or a one-key map from
// a label to a query. The snapshot holds them in config order for the panel that
// lists them; this table pins its reader to kanban-web's, entry form by entry
// form, the malformed ones included.

function pillsFor(config) {
  return withSnapshot({ ...BOARD, config }, (html) => embeddedConst(html, 'PILLS'));
}

const PILL_FORMS = {
  'quoted queries, a bare query and one-key maps': 'name: b\npills:\n  - "assignee:@human"\n  - \'status:doing\'\n  - blocked\n  - next: \'tags:"next-up"\'\n  - "review it": "review:"\n',
  'assignee:@human and tags:* bare and quoted stay queries': 'name: b\npills:\n  - assignee:@human\n  - tags:*\n  - "tags:*"\n',
  'a colon followed by a space makes a map: "- tags: grill" is the label tags with the query grill': 'name: b\npills:\n  - tags: grill\n',
  'a map value that is quoted, bare or has a trailing comment, with colons inside': 'name: b\npills:\n  - mine: assignee:@human   # who I am\n  - both: "tags:a tags:b"  # two tags\n  - note: \'title:"fix: auth"\'\n',
  'a name key is a literal label like any other word': 'name: b\npills:\n  - name: tags:x\n  - "name": "tags:y"\n',
  'an empty label, an empty query and comment-only entries are skipped': 'name: b\npills:\n  -\n  - ""\n  - "": tags:x\n  - next:\n  - next: ""\n  - # only a comment\n  # a comment line\n  - next: # only a comment\n  - tags: grill\n',
  'extra keys on a map are ignored': 'name: b\npills:\n  - next: \'tags:"next-up"\'\n    color: red\n    query: ignored\n  - "assignee:@human"\n',
  'a scalar value answers none': 'name: b\npills: tags:*\n',
  'an inline list answers none': 'name: b\npills: ["tags:*", "assignee:@human"]\n',
  'an empty inline list answers none': 'name: b\npills: []\n',
  'an empty key answers none': 'name: b\npills:\n',
  'no pills key answers none': 'name: b\nstatuses: [todo, done]\n',
  'a comment after the key opens the block': 'name: b\npills:   # one-click queries\n  - next: x\n',
  'CRLF text that stops at the next top-level key': 'name: b\r\npills:\r\n  - next: "tags:next-up"\r\nstatuses: [todo, done]\r\n  - stray\r\n',
  'an unindented list is skipped, as for every other list': 'name: b\npills:\n- next: x\n  - "assignee:@human"\n- tags:*\n',
  'a single-quoted entry keeps YAML\'s doubled quote as it is': "name: b\npills:\n  - 'it''s'\n  - 'it''s': 'a''b'\n  - n: 'a''b'\n",
  'backslash escapes apply in both quote styles': 'name: b\npills:\n  - "say \\"hi\\"": "title:\\"x\\""\n  - \'a\\\\b\': \'c\\\\d\'\n  - "tags:\\\\x"\n',
  'an unterminated quote': 'name: b\npills:\n  - "next: x\n  - \'tags:y\n  - "ok": "tags:z\n',
  'a quoted label with nothing after the colon, and a quoted query ending in a colon': 'name: b\npills:\n  - "next":\n  - "blocked:"\n  - "review it": "review:"\n  - blocked:\n',
  'a hash that is part of a query, and one that starts a comment': 'name: b\npills:\n  - tags:#x\n  - next: tags:#y # note\n  - tags:z # note\n  - "tags:#w" # note\n',
  'a label with spaces and a query with markup': 'name: b\npills:\n  - review it: title:<b>x</b>\n  - "<i>label</i>": "body:\\"<script>\\""\n',
  'two pills keys in one file': 'name: b\npills:\n  - a: x\nstatuses: [todo, done]\npills:\n  - b: y\n',
  'pills between the other lists': 'name: b\ntypes:\n  - name: goal\n    icon: star\npills:\n  - next: "tags:next-up"\n  - "assignee:@human"\nhierarchy: [goal, epic]\nstatuses: [todo, done]\n',
};

for (const [label, config] of Object.entries(PILL_FORMS)) {
  test(`pills: ${label} reads the way kanban-web reads it`, () => {
    assert.deepStrictEqual(pillsFor(config), parseConfig(config).pills);
  });
}

test('pills keep the order they are written in, each a label and a query', () => {
  const config = 'name: b\npills:\n  - next: \'tags:"next-up"\'\n  - "assignee:@human"\n  - tags:*\n  - tags: grill\n  - -\n';
  assert.deepStrictEqual(pillsFor(config), [
    { label: 'next', query: 'tags:"next-up"' },
    { label: 'assignee:@human', query: 'assignee:@human' },
    { label: 'tags:*', query: 'tags:*' },
    { label: 'tags', query: 'grill' },
    { label: '-', query: '-' },
  ]);
});

test('a board without a pills key holds an empty list', () => {
  assert.deepStrictEqual(pillsFor('name: b\n'), []);
  assert.deepStrictEqual(pillsFor(BOARD.config), []);
});

test('pill labels and queries that look like markup cannot close the script element, and arrive as the text they are', () => {
  withSnapshot({ ...BOARD, config: 'name: b\npills:\n  - "</script><b>": "title:</SCRIPT >x"\n' }, (html) => {
    assert.deepStrictEqual(embeddedConst(html, 'PILLS'), [{ label: '</script><b>', query: 'title:</SCRIPT >x' }]);
  });
});

// The board's hierarchy: the types that are the tiers of the plan, top first. The
// snapshot hands it, as written, to the web's slices module, which compares the
// names without regard to case and keeps the first of two duplicates; so this table
// pins the snapshot's reader to kanban-web's, entry form by entry form, the
// malformed ones included.

function hierarchyFor(config) {
  return withSnapshot({ ...BOARD, config }, (html) => embeddedConst(html, 'HIERARCHY'));
}

const HIERARCHY_FORMS = {
  'an inline list': 'name: b\nhierarchy: [goal, strategy, objective, epic]\n',
  'an inline list with quotes, spaces and a trailing comment': 'name: b\nhierarchy: [goal, "Strategy", \'objective\' ,epic]   # top first\n',
  'a block list': 'name: b\nhierarchy:\n  - goal\n  - strategy\n  - objective\n',
  'a block list with quotes and trailing comments': 'name: b\nhierarchy:\n  - goal # the why\n  - "Strategy"\n  - \'objective\' # the middle\n  - epic\n',
  'a comment after the key opens the block': 'name: b\nhierarchy:   # top first\n  - goal\n  - epic\n',
  'a scalar value answers none': 'name: b\nhierarchy: goal\n',
  'a quoted scalar with a comma answers none': 'name: b\nhierarchy: "goal, epic"\n',
  'an empty inline list answers none': 'name: b\nhierarchy: []\n',
  'an empty key answers none': 'name: b\nhierarchy:\n',
  'no hierarchy key answers none': 'name: b\nstatuses: [todo, done]\n',
  'a board that declares types but no hierarchy answers none': 'name: b\ntypes:\n  - name: goal\n  - name: epic\n',
  'mixed-case duplicates are kept as written, for the slices module to fold': 'name: b\nhierarchy: [goal, Epic, goal, Goal, EPIC]\n',
  'mixed-case duplicates in a block': 'name: b\nhierarchy:\n  - Goal\n  - goal\n  - Epic\n  - EPIC\n',
  'blank entries in an inline list are skipped': 'name: b\nhierarchy: [goal, , epic, "", goal]\n',
  'blank, empty, comment-only and comment-line entries in a block are skipped': 'name: b\nhierarchy:\n  - goal\n  -\n  - ""\n  - epic\n  # a comment line\n  - # only a comment\n  - goal\n',
  'an unterminated quote': 'name: b\nhierarchy:\n  - "goal\n  - \'epic\n  - ok\n',
  'CRLF text that stops at the next top-level key': 'name: b\r\nhierarchy:\r\n  - goal\r\n  - epic\r\nstatuses: [todo, done]\r\n  - stray\r\n',
  'an unindented list is skipped, as for every other list': 'name: b\nhierarchy:\n- goal\n  - epic\n- story\n',
  'keys after the list': 'name: b\nhierarchy: [goal, epic]\nstatuses: [todo, done]\ntypes: [goal, epic]\n',
  'an inline key, then a block key, adds to it': 'name: b\nhierarchy: [goal]\nstatuses: [todo, done]\nhierarchy:\n  - epic\n',
  'an inline key after a block key replaces it': 'name: b\nhierarchy:\n  - epic\nstatuses: [todo, done]\nhierarchy: [goal]\n',
  'an inline key twice, then a block, then a scalar': 'name: b\nhierarchy: [goal]\nhierarchy: [epic]\nhierarchy:\n  - story\nhierarchy: task\n',
  'a hierarchy between the other lists': 'name: b\ntypes:\n  - name: goal\n    icon: star\nhierarchy:\n  - goal\n  - epic\npills:\n  - next: "tags:next-up"\nstatuses: [todo, done]\n',
  'a name that looks like markup': 'name: b\nhierarchy: ["</script><b>", epic]\n',
};

for (const [label, config] of Object.entries(HIERARCHY_FORMS)) {
  test(`hierarchy: ${label} reads the way kanban-web reads it`, () => {
    assert.deepStrictEqual(hierarchyFor(config), parseConfig(config).hierarchy);
  });
}

test('the hierarchy keeps the order and the letter case it is written in, and a board without one holds an empty list', () => {
  assert.deepStrictEqual(hierarchyFor('name: b\nhierarchy:\n  - Goal\n  - strategy\n  - OBJECTIVE\n'), ['Goal', 'strategy', 'OBJECTIVE']);
  assert.deepStrictEqual(hierarchyFor('name: b\n'), []);
  assert.deepStrictEqual(hierarchyFor(BOARD.config), []);
});

test('a hierarchy name that looks like markup cannot close the script element, and arrives as the text it is', () => {
  withSnapshot({ ...BOARD, config: 'name: b\nhierarchy: ["</script><b>", epic]\n' }, (html) => {
    assert.deepStrictEqual(embeddedConst(html, 'HIERARCHY'), ['</script><b>', 'epic']);
  });
});
