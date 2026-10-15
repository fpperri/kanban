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
