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
  'no types key': 'name: b\nstatuses: [todo, done]\n',
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

test('no priorities key leaves the list empty, so the module falls back to High, Normal, Low', () => {
  assert.deepStrictEqual(prioritiesFor('name: b\n'), []);
});
