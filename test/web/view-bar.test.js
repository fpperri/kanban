const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/page-vm');
const { assertKeepsSelection, tagsOf } = require('./helpers/markers');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
const BOARD = { projectName: 'k', statuses: ['todo'], priorities: [], assignees: [], tags: [], types: [], active: [], archived: [] };
const MODES = ['board', 'calendar', 'gantt', 'map', 'graph'];

test('the view bar is a nav right after the Graph with one button per view, each keeping the selection', () => {
  assert.match(html, /<div id="graph-view"[^>]*><\/div>\s*<nav id="view-bar"/);
  const tags = tagsOf('.view-bar-btn');
  assert.deepStrictEqual(tags.map((t) => t.match(/data-view="(\w+)"/)[1]), MODES);
  for (const t of tags) assert.doesNotMatch(t, /data-view-toggle|\sstyle=|\son[a-z]+=/, t);
  assertKeepsSelection(['.view-bar-btn'], 'a view bar button');
});

test('the nav does not carry the option-button strip class, whose sticky offsets would pull the fixed bar off the bottom', () => {
  assert.doesNotMatch(html.match(/<nav id="view-bar"[^>]*>/)[0], /class=/);
});

test('the bar buttons are empty slots the page fills once from the views table', async () => {
  const page = await loadPage({ board: BOARD }).start();
  assert.strictEqual(typeof page.run('fillViewBar'), 'function');
  const slots = html.match(/<nav id="view-bar"[\s\S]*?<\/nav>/)[0];
  assert.strictEqual((slots.match(/class="btn-icon"/g) || []).length, 5);
  assert.strictEqual((slots.match(/class="btn-label"/g) || []).length, 5);
});

test('setView assigns the view and never toggles it', async () => {
  const page = await loadPage({ board: BOARD, stored: { 'kanban.k.view.mode': 'graph' } }).start();
  const view = () => page.run('loadViewMode()');
  assert.strictEqual(view(), 'graph');
  page.run("setView('graph')");
  assert.strictEqual(view(), 'graph', 'the current view stays');
  page.run("setView('board')");
  assert.strictEqual(view(), 'board');
  page.run("setView('board')");
  assert.strictEqual(view(), 'board', 'the Board is not a toggle back');
  page.run("setView('calendar')");
  assert.strictEqual(view(), 'calendar');
});

test('setView sits directly above toggleView', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');
  assert.match(src, /function setView\(mode\) \{[\s\S]*?\n\}\n\n(?:\/\/[^\n]*\n)*function toggleView/);
});

test('at phone width every view is 100dvh minus the header and the bar, the Board also the tab strip; from 760 px the bar is off', () => {
  assert.match(css, /\n#view-bar \{ display: none;/);
  const phone = css.split('@media (max-width: 759.98px) {').slice(1).join('\n');
  assert.match(phone, /#view-bar \{[^}]*display: flex;[^}]*env\(safe-area-inset-bottom\)/);
  for (const sel of [String.raw`.calendar-view, .gantt-view`]) {
    assert.match(phone, new RegExp(String.raw`${sel} \{[^}]*height: calc\(100dvh - var\(--board-header-h, 64px\) - 48px - var\(--view-bar-h`), sel);
  }
  const heights = css.match(/\n  \.map-view, \.graph-view \{ height: calc\(100dvh - var\(--board-header-h, 64px\) - 48px - var\(--view-bar-h\)\); \}/);
  assert.ok(heights, 'the Map and Graph phone height rule exists');
  const at = css.indexOf(heights[0]);
  assert.ok(at > css.lastIndexOf('\n.map-view {'), 'it follows the last base .map-view rule, so it wins the cascade');
  assert.ok(at > css.lastIndexOf('\n.graph-view {'), 'it follows the last base .graph-view rule, so it wins the cascade');
  assert.match(phone, /main#board \{[^}]*height: calc\(100dvh - var\(--board-header-h, 64px\) - 48px - 48px - var\(--view-bar-h/);
  assert.match(phone, /\.actions > button\[data-view-toggle\]:has\(\.btn-icon\) \{ display: none; \}/, 'outranks .actions > button:has(.btn-icon), which sets inline-flex');
});

test('the phone header hides every .btn-label, so the view bar un-hides its own five words', () => {
  const phone = css.split('@media (max-width: 759.98px) {').slice(1).join('\n');
  assert.match(phone, /\n  \.btn-label \{[^}]*clip: rect\(0 0 0 0\)/, 'the header rule that clips labels exists');
  const rule = phone.match(/#view-bar \.view-bar-btn \.btn-label \{([^}]*)\}/);
  assert.ok(rule, 'the view bar overrides the label clip');
  for (const decl of ['position: static', 'width: auto', 'height: auto', 'overflow: visible', 'clip: auto']) assert.ok(rule[1].includes(decl), decl);
});
