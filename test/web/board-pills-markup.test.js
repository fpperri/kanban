const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What the board's own pills add to the page: the stylesheet rules for the "+N more"
// button and for a long value, kept to the panel's marked block, tokens only, and no
// inline style anywhere in the panel script (the page runs under a strict CSP).

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('app.css');
const panelSrc = read('search-panel.js');
const pillsSrc = read('pills.js');
const block = css.slice(css.indexOf('/* Search box and search panel.'), css.indexOf('/* End search box and search panel */'));

test('the more button has a rule in the panel\'s marked block, and it is not drawn as a pill', () => {
  const rule = block.match(/\.query-pill-more \{([^}]*)\}/);
  assert.ok(rule, 'the rule is there');
  assert.match(rule[1], /cursor: pointer/);
  assert.doesNotMatch(rule[1], /background: var\(--accent/, 'it never looks switched on');
  assert.doesNotMatch(css.replace(block, ''), /query-pill-more/, 'and no rule for it outside the block');
});

test('the more button shows the focus ring the pills show, and darkens as they do on hover', () => {
  assert.match(block, /\.query-pill-more:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(block, /\.query-pill-more:hover \{[^}]*color: var\(--ink\)/);
});

test('a long value wraps inside its pill and the pill stays inside the panel', () => {
  assert.match(block.match(/\.query-pill \{([^}]*)\}/)[1], /max-width: 100%/);
  assert.match(block.match(/\.query-pill-label \{([^}]*)\}/)[1], /overflow-wrap: anywhere/);
  assert.match(block.match(/\.query-pill-label \{([^}]*)\}/)[1], /min-width: 0/);
});

test('the colours the new rules use are the page\'s tokens, each one declared, and none is a literal', () => {
  const mine = [...block.matchAll(/\.query-pill-more[^{]*\{[^}]*\}|\.query-pill-label \{[^}]*\}/g)].map((m) => m[0]).join('\n');
  assert.ok(mine.length > 100, 'the rules are found');
  assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  const declared = new Set([...css.slice(0, css.indexOf(':root[data-theme="dark"]')).matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
  for (const m of mine.matchAll(/var\(--([a-z-]+)/g)) assert.ok(declared.has(m[1]), `--${m[1]} is declared`);
});

test('the panel script sets no inline style and no inline handler, and the pill list holds no DOM', () => {
  for (const [where, src] of [['the panel script', panelSrc], ['the pill list', pillsSrc]]) {
    assert.doesNotMatch(src, /\.style\b|setAttribute\('style'|cssText|\bonclick\b|setAttribute\('on/i, where);
  }
  assert.doesNotMatch(pillsSrc, /\bdocument\b|\bwindow\.(?!BUILT_IN_PILLS|PILLS_SHOWN|pill|panelChip)/);
});

test('the more button is built with the class the stylesheet and the click handler look for', () => {
  assert.match(panelSrc, /className = 'query-pill-more'/);
  assert.match(panelSrc, /closest\('\.query-pill-more'\)/);
  assert.match(css, /\.query-pill-more/);
});
