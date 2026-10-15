const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

const from = webSkill.indexOf('- **Deep links**');
const to = webSkill.indexOf('- **Card popup history');
assert.ok(from > 0 && to > from, 'the deep-link section is found');
const deepLinks = webSkill.slice(from, to).replace(/\s+/g, ' ');

test('the deep-link section says the address follows the search box', () => {
  assert.match(deepLinks, /The address follows the box/);
  assert.match(deepLinks, /`q` .{0,40}the box's text/);
  assert.match(deepLinks, /empty or blank box drops `q`/);
  assert.match(deepLinks, /`card` and `view` ride along untouched/);
});

test('the deep-link section says typing adds no history entries', () => {
  assert.match(deepLinks, /replaces the history entry the page is on/);
  assert.match(deepLinks, /typing adds no history entries/);
});

test('the deep-link section says a reload or a copied link opens with the same search, and Back and Forward leave the box alone', () => {
  assert.match(deepLinks, /A reload, or a link copied from the address bar, opens with the same search/);
  assert.match(deepLinks, /Back and Forward never write the box/);
  assert.match(deepLinks, /the poll never writes the address/i);
});
