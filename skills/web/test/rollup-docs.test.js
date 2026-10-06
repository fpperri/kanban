const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = read('docs', 'web.md');

const bullet = () => {
  const start = webSkill.indexOf('- **Parent cards: altitude badge and roll-up bar**');
  assert.ok(start > -1, 'the web skill has a parent-cards bullet');
  return webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
};

test('the web skill describes the badge, the leaves-only bar, and the open, collapsed and off choices', () => {
  const text = bullet();
  assert.match(text, /`▲n`/);
  assert.match(text, /leaves/);
  assert.match(text, /collapsed/);
  assert.match(text, /open/);
  assert.match(text, /off/);
  assert.match(text, /remembered per board in `localStorage`/);
});

test('the web skill says archived leaves count as done by default and can be left out', () => {
  const text = bullet();
  assert.match(text, /Archived\*\* checkbox/);
  assert.match(text, /as done, on by default/);
});

test('the web skill says the scope line counted this board only, and why', () => {
  const text = bullet();
  assert.match(text, /this board only/);
  assert.match(text, /cannot know about children on a board it never reads/);
});

test('the web skill says marking a parent done with open leaves warns and still saves', () => {
  const text = bullet();
  assert.match(text, /warning and saves anyway/);
  assert.match(text, /literal status `done`/);
});

test('the web skill says the derived values are never written to a card', () => {
  assert.match(bullet(), /never written to a card/);
});

test('the human docs mention the badge, the bar and the warning', () => {
  const text = webDoc.replace(/\s+/g, ' ');
  assert.match(text, /`▲n`/);
  assert.match(text, /this board only/);
  assert.match(text, /warns and saves anyway/);
});
