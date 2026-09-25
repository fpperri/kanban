const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The snapshot is one HTML file that must open with nothing fetched, so it
// cannot link the web board's stylesheet: it carries its own copy of the token
// values. This keeps the copy honest. Every token both surfaces declare holds
// the same value in each of the three theme blocks, and the status and
// identity tokens are the ones status-colors.js owns.
const py = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build_editor.py'), 'utf8');
const snapCss = py.slice(py.indexOf('<style>') + '<style>'.length, py.indexOf('</style>'));
const webCss = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'app.css'), 'utf8');
const { themeColorTokens } = require('../../web/web/status-colors');

function blockAt(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(openIdx + 1, i); }
  }
  throw new Error('unbalanced braces');
}
function blockAfter(css, re, label) {
  const m = re.exec(css);
  assert.ok(m, `${label}: selector not found`);
  return blockAt(css, css.indexOf('{', m.index));
}
function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = m[2].replace(/\s+/g, '').toLowerCase();
  return out;
}
function themeBlocks(css, label) {
  const media = blockAfter(css, /@media\s*\(prefers-color-scheme:\s*dark\)/, `${label} media query`);
  return {
    light: tokens(blockAfter(css, /:root\s*\{/, `${label} :root`)),
    media: tokens(blockAfter(media, /:root:not\(\[data-theme="light"\]\)\s*\{/, `${label} guarded dark`)),
    dark: tokens(blockAfter(css, /:root\[data-theme="dark"\]\s*\{/, `${label} [data-theme="dark"]`)),
  };
}
const snap = themeBlocks(snapCss, 'snapshot');
const web = themeBlocks(webCss, 'app.css');

test('every token the snapshot shares with the web board holds the same value, block by block', () => {
  for (const which of ['light', 'media', 'dark']) {
    const shared = Object.keys(snap[which]).filter((k) => k in web[which]);
    assert.ok(shared.length >= 40, `${which}: only ${shared.length} shared tokens — the snapshot should use the web's names`);
    for (const k of shared) {
      assert.strictEqual(snap[which][k], web[which][k], `${which} block: --${k} is ${snap[which][k]} in the snapshot, ${web[which][k]} in app.css`);
    }
  }
});

test('the snapshot declares every status and identity token with status-colors.js values', () => {
  for (const [which, theme] of [['light', 'light'], ['media', 'dark'], ['dark', 'dark']]) {
    for (const [k, v] of Object.entries(themeColorTokens(theme))) {
      if (k.endsWith('-hover')) continue; // gantt-only hover twins; the snapshot draws no hover diamond
      assert.strictEqual(snap[which][k], v.toLowerCase(), `${which} block: --${k}`);
    }
  }
});
