const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { sliceCards, sliceDepths } = require('../../plugin/skills/web/web/slices');

// The glossary, the web and snapshot docs and both skills say what a depth slice counts: the
// parents without a tier between a card and its nearest parent with one, so a card right
// under an epic is depth 0. The example they give is held to the slices module.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const glossary = flat(read('GLOSSARY.md'));
const webDocs = flat(read('docs', 'web.md'));
const snapshotDocs = flat(read('docs', 'snapshot.md'));
const webSkill = flat(read('plugin', 'skills', 'web', 'SKILL.md'));
const snapshotSkill = flat(read('plugin', 'skills', 'snapshot', 'SKILL.md'));

test('the glossary says a depth slice counts the parents without a tier below the nearest tier card, and Depth stays parents above', () => {
  assert.match(glossary, /A card without a tier is in the depth slice of how many parents without a tier sit between it and its nearest parent with a tier, or its root when none has one/);
  assert.match(glossary, /a card right under an epic is depth 0 and its child depth 1: the hierarchy does not count as depth/);
  assert.match(glossary, /\*\*Depth\*\* \(derived\): How many parents sit above a card: a root is 0\./);
});

test('the web docs and skill say the depth slices count from the nearest tier card above', () => {
  assert.match(webDocs, /the depths of the cards with no tier, counted from the nearest tier card above \(a card right under an epic is depth 0, its child depth 1, and a root with no tier above it is 0\)/);
  assert.match(webDocs, /a ring for each depth that holds a card without a tier, the first ring being the cards right under a tier card/);
  assert.match(webSkill, /the depths of the cards with no tier \(the parents without a tier between a card and its nearest parent with one, or its root when none has: a card right under an epic is 0, its child 1\)/);
  assert.match(webSkill, /counted from the nearest tier card above, so the first ring is the cards right under a tier card/);
  assert.match(webSkill, /A board with no `hierarchy:` cuts by depth, the parents above a card \(`slice:1` is the depth-1 cards\)/);
  assert.doesNotMatch(webSkill, /parents above, a root is 0\)/);
});

test('the snapshot docs and skill say the same', () => {
  assert.match(snapshotDocs, /the depths of the cards with no tier, counted from the nearest tier card above \(a card right under an epic is depth 0\)/);
  assert.match(snapshotSkill, /the depths of the cards with no tier, counted from the nearest tier card above \(a card right under an epic is depth 0\)/);
});

test('the example the docs give holds: a card right under an epic is depth 0, its child depth 1, a root with no tier above it is 0', () => {
  const ctx = { board: 'b' };
  const hierarchy = ['goal', 'epic'];
  const cards = [
    { id: '1', type: 'goal', parent: null },
    { id: '2', type: 'epic', parent: '1' },
    { id: '3', parent: '2' },
    { id: '4', parent: '3' },
    { id: '5', parent: null },
  ];
  const { byId } = sliceCards(cards, hierarchy, sliceDepths(cards, hierarchy, ctx));
  assert.deepStrictEqual(['3', '4', '5'].map((id) => byId.get(id).depth), [0, 1, 0]);
});
