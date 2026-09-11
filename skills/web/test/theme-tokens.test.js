const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban.proj#255 chrome-palette adoption, phase 2 -------------------
// The token block at the top of app.css carries the shop status page's
// CHROME palette as a real three-state theme: a complete LIGHT set on bare
// :root, the DARK set redefined under prefers-color-scheme for the "system"
// default, and redefined again under [data-theme="dark"] so an explicit
// choice wins over the OS setting in both directions. A token declared in
// only one of the three blocks resolves to nothing wherever it's missing —
// an unstyled box, not a themed one — so this file pins the shape itself,
// not just today's values.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

function block(source, startIdx) {
  // startIdx points at the '{' that opens the block; returns the substring
  // between its matching braces (nesting-aware, since the media query
  // wraps its own :root rule in an outer pair).
  let depth = 0;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx + 1, i);
    }
  }
  throw new Error('unbalanced braces from index ' + startIdx);
}

function tokensOf(blockText) {
  const out = new Map();
  const re = /--([a-z-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockText))) out.set(m[1], m[2].trim());
  return out;
}

const rootStart = css.indexOf(':root {');
assert.ok(rootStart > -1, 'a bare :root block opens the file');
const rootBlock = block(css, css.indexOf('{', rootStart));
const rootTokens = tokensOf(rootBlock);

const mediaIdx = css.indexOf('@media (prefers-color-scheme: dark)');
assert.ok(mediaIdx > -1, 'a prefers-color-scheme: dark query exists');
const mediaOuter = block(css, css.indexOf('{', mediaIdx));
const mediaRootIdx = mediaOuter.indexOf(':root:not([data-theme="light"])');
assert.ok(mediaRootIdx > -1, 'the media query is guarded by :root:not([data-theme="light"]), so an explicit light choice overrides it');
const mediaBlock = block(mediaOuter, mediaOuter.indexOf('{', mediaRootIdx));
const mediaTokens = tokensOf(mediaBlock);

const darkAttrIdx = css.indexOf(':root[data-theme="dark"]');
assert.ok(darkAttrIdx > -1, 'a :root[data-theme="dark"] block exists, so an explicit dark choice wins regardless of OS setting');
const darkAttrBlock = block(css, css.indexOf('{', darkAttrIdx));
const darkAttrTokens = tokensOf(darkAttrBlock);

test('every token on bare :root is redeclared under both dark blocks, with the same name set', () => {
  assert.ok(rootTokens.size > 0, 'the light token block is non-empty');
  const rootNames = [...rootTokens.keys()].sort();
  const mediaNames = [...mediaTokens.keys()].sort();
  const darkAttrNames = [...darkAttrTokens.keys()].sort();
  assert.deepStrictEqual(mediaNames, rootNames,
    'the prefers-color-scheme dark block declares exactly the tokens :root does — none defined only inside a media query');
  assert.deepStrictEqual(darkAttrNames, rootNames,
    'the [data-theme="dark"] block declares exactly the tokens :root does');
});

test('the two dark blocks agree on every shared token value — one dark palette, not two', () => {
  for (const [name, value] of mediaTokens) {
    assert.strictEqual(darkAttrTokens.get(name), value,
      `--${name}: the prefers-color-scheme block and the [data-theme="dark"] block must declare the same value`);
  }
});

test(':root declares color-scheme: light dark, so native form controls/scrollbars follow the same three-state contract', () => {
  assert.match(rootBlock, /color-scheme:\s*light dark/);
});

test('no @import and no color-mix()/light-dark() — an unsupported color function is a silently dropped declaration, and this suite has no jsdom to catch the resulting unstyled box', () => {
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /color-mix\(/);
  assert.doesNotMatch(css, /light-dark\(/);
});

// --- KEEP LITERAL allowlist: status-colors.js's exported hexes, plus the
// handful of board-semantic hexes that are hex-pinned by other tests but
// have no export of their own (the overdue red, the waiting-amber hover
// twin, and review gold). Every other hex literal in app.css should have
// resolved to a token by phase 2. Excluded from the scan: comments (a few
// narrate design history with a hex that moved — see the restricted
// comment-editing rule — rather than describing live CSS) and the three
// token-definition blocks themselves, which are the one place a raw hex is
// the whole point: they're what every var() elsewhere resolves through.
const statusColors = require('../web/status-colors.js');
const identityAllowlist = new Set([
  ...Object.values(statusColors.BUILTIN_STATUS_COLORS),
  statusColors.ARCHIVE_COLOR,
  statusColors.EPIC_COLOR,
  ...statusColors.STATUS_PALETTE,
  '#f85149', // priority/blocked/overdue red — status-colors.test.js/overdue.test.js pin it
  '#d29922', // waiting amber — already in STATUS_PALETTE, listed for clarity
  '#e3b341', // .gantt-due-marker:hover::before — hover twin of the locked waiting amber
  '#eac54f', // ADR-0009 review-pill gold — not in status-colors.js, out of scope for this change
].map((h) => h.toLowerCase()));

test('every surviving hex literal in app.css (outside comments and the token blocks) is a status/priority/identity color, never an untokenized chrome value', () => {
  let body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Cut the three token-definition blocks out of a fresh (comment-stripped)
  // copy by the same brace-matching used to read them above, so this stays
  // correct even if the file grows more rules around them.
  const strip = (source, openBraceIdx) => {
    let depth = 0;
    for (let i = openBraceIdx; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(0, openBraceIdx) + source.slice(i + 1);
      }
    }
    throw new Error('unbalanced braces');
  };
  body = strip(body, body.indexOf('{', body.indexOf(':root {')));
  body = strip(body, body.indexOf('{', body.indexOf('@media (prefers-color-scheme: dark)')));
  body = strip(body, body.indexOf('{', body.indexOf(':root[data-theme="dark"]')));
  const hexes = body.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const offenders = [...new Set(hexes.map((h) => h.toLowerCase()))].filter((h) => !identityAllowlist.has(h));
  assert.deepStrictEqual(offenders, [], `unexpected non-identity hex literal(s) still in app.css: ${offenders.join(', ')}`);
});
