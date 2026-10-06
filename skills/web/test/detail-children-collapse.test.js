const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const css = read('app.css');

function fn(name) {
  const m = appSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, title: `Card ${id}`, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);

function childrenHtmlOf(cards, id) {
  const sandbox = {
    escapeHtml: require('../web/assignee-badge').escapeHtml,
    cardTitleDisplay: require('../web/card-title').cardTitleDisplay,
    ...require('../web/nesting'),
  };
  vm.createContext(sandbox);
  vm.runInContext([fn('relativeMentionHtml'), fn('archivedMarkHtml'), fn('threadEntryHtml'), fn('childEntryHtml'), fn('detailRelativesHtml')].join('\n'), sandbox);
  return sandbox.detailRelativesHtml(cards, id, CTX).childrenHtml;
}

const family = () => [card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 1, archived: true })];

test('a parent\'s children start collapsed behind a header that carries their count', () => {
  const out = childrenHtmlOf(family(), 1);
  assert.match(out, /<button type="button" class="relatives-toggle" aria-expanded="false" aria-controls="detail-children-list">/);
  assert.match(out, /<span class="relatives-label">Children<\/span>\s*<span class="relatives-count">3<\/span>/, 'archived children are counted too');
  assert.match(out, /<ul class="children-list hidden" id="detail-children-list">/);
});

test('the header comes before the list, and every child is still in the list', () => {
  const out = childrenHtmlOf(family(), 1);
  assert.ok(out.indexOf('relatives-toggle') < out.indexOf('children-list'));
  assert.deepStrictEqual([...out.matchAll(/data-card-id="(\d+)"/g)].map((m) => Number(m[1])), [2, 3, 4]);
});

test('a card with no children has no header either', () => {
  assert.strictEqual(childrenHtmlOf(family(), 2), '');
});

function toggleSandbox() {
  const classes = new Set(['hidden']);
  const attrs = {};
  const list = {
    classList: { toggle: (c) => { if (classes.has(c)) classes.delete(c); else classes.add(c); return classes.has(c); } },
  };
  const btn = { setAttribute: (k, v) => { attrs[k] = v; } };
  const sandbox = { $: (sel) => { assert.strictEqual(sel, '#detail-children-list'); return list; }, classes, attrs };
  vm.createContext(sandbox);
  vm.runInContext(fn('toggleDetailChildren'), sandbox);
  return { toggle: () => sandbox.toggleDetailChildren(btn), classes, attrs };
}

test('one click expands the children and another collapses them', () => {
  const s = toggleSandbox();
  s.toggle();
  assert.strictEqual(s.classes.has('hidden'), false);
  assert.strictEqual(s.attrs['aria-expanded'], 'true');
  s.toggle();
  assert.strictEqual(s.classes.has('hidden'), true);
  assert.strictEqual(s.attrs['aria-expanded'], 'false');
});

test('the popup\'s one click listener area reaches the header, and the toggle is a real button', () => {
  assert.match(appSrc, /\$\('#detail-modal'\)\.addEventListener\('click', \(e\) => \{ const t = e\.target\.closest\('\.relatives-toggle'\); if \(t\) toggleDetailChildren\(t\); \}\);/);
});

test('every open of a card re-renders the children collapsed', () => {
  assert.match(fn('renderDetailRelatives'), /el\.innerHTML = markup/, 'the markup is rebuilt each time, so the collapsed default returns');
});

test('the header is a plain button with a chevron, in tokens', () => {
  const rule = css.match(/\n\.relatives-toggle \{([^}]*)\}/);
  assert.ok(rule, '.relatives-toggle rule exists');
  assert.match(rule[1], /cursor:\s*pointer/);
  assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,8}\b/);
  assert.match(css, /\.relatives-toggle::before \{[^}]*content:/);
  assert.match(css, /\.relatives-toggle\[aria-expanded="true"\]::before \{[^}]*content:/);
});
