const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseConfig } = require('../scripts/config-store');
const it = require('../web/iterations');

// The kanban skill documents the `iterations:` key and the web skill and docs describe the dropdown.
// The example they give is held to the code, so a doc cannot promise what the page does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const kanban = read('skills', 'kanban', 'SKILL.md');
const web = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const kanbanKey = flat(kanban.slice(kanban.indexOf('**`iterations` —'), kanban.indexOf('**`logbook` —')));
const webBullet = flat(web.slice(web.indexOf('- **Iterations** —'), web.indexOf('- **Hover/focus highlight**')));
const docsPara = flat(docs.slice(docs.indexOf('**Iterations**'), docs.indexOf('## Other surfaces')));

test('the kanban skill documents the iterations key: a human writes it, it needs groups, and it adds only the picker', () => {
  assert.ok(kanbanKey.length > 200, 'the iterations paragraph is found');
  for (const part of ['`iterations: true`', 'needs the `groups:` line', 'the `iteration/` folder', 'only adds a picker to the web', 'A human writes the line']) {
    assert.ok(kanbanKey.includes(part), part);
  }
});

test('the web skill describes the dropdown: what it lists, what it opens on, what a pick does and where it is kept', () => {
  assert.ok(webBullet.length > 600, 'the Iterations bullet is found');
  for (const part of ['`iterations: true`', '**All cards**', 'newest first', '**New iteration…**', 'the running iteration', 'on top of the search box',
    'never writes the box', 'never changes a group', 'this browser only', 'Calendar shades', 'first day', '`auto_join` on']) {
    assert.ok(webBullet.includes(part), part);
  }
});

test('the web docs describe the same, in a paragraph of their own', () => {
  assert.ok(docsPara.length > 400, 'the Iterations paragraph is found');
  for (const part of ['`iterations: true`', 'All cards', 'New iteration…', 'running iteration', 'search box', 'this browser', 'Calendar']) {
    assert.ok(docsPara.includes(part), part);
  }
});

test('the example the docs give does what it says', () => {
  const config = parseConfig('groups: .groups\niterations: true\n');
  assert.strictEqual(config.iterations, true);
  const groups = [
    { id: 'I2', name: 'zephyr-2', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true, cards: [] },
  ];
  assert.strictEqual(it.iterationNextDraft(groups, '2026-10-15').name, 'zephyr-3', 'zephyr-2 becomes zephyr-3');
  assert.ok(web.includes('zephyr-2') && web.includes('zephyr-3'), 'the web skill names the example');
});
