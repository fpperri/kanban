const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Theme tokens (kanban.proj #274 goal 1): the snapshot adopts the shop's
// three-state token structure — a light `:root`, a `prefers-color-scheme:
// dark` block scoped to `:not([data-theme="light"])`, and an explicit
// `[data-theme="dark"]` block, plus a light `[data-theme="light"]` override
// — with the shop's own token names and values. Every token must appear in
// all three color-bearing blocks with the same name set, and no color may
// live only inside a media query. Same source-as-text technique
// format-body.test.js and friends use (no build step, no DOM).

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function extractStyleBlock() {
  const start = src.indexOf('<style>');
  const end = src.indexOf('</style>');
  assert.ok(start !== -1 && end !== -1, '<style> block not found');
  return src.slice(start + '<style>'.length, end);
}
const css = extractStyleBlock();

// Pull a `{ ... }` declaration block by its exact selector prefix — brace-
// balanced so nested rgba()/var() parens never confuse it.
function ruleBody(selectorPrefix, fromIndex) {
  const start = css.indexOf(selectorPrefix, fromIndex || 0);
  assert.ok(start !== -1, `selector "${selectorPrefix}" not found`);
  const braceStart = css.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return { body: css.slice(braceStart + 1, i - 1), end: i };
}

function tokenNames(body) {
  return [...body.matchAll(/--([a-z-]+):/g)].map((m) => m[1]).sort();
}

const rootRule = ruleBody(':root{');
const mediaStart = css.indexOf('@media(prefers-color-scheme:dark)');
assert.ok(mediaStart !== -1, 'no @media(prefers-color-scheme:dark) block found');
const mediaBlockOuter = ruleBody(':root:not([data-theme="light"]){', mediaStart);
const darkAttrRule = ruleBody(':root[data-theme="dark"]{');
const lightAttrIdx = css.indexOf(':root[data-theme="light"]');
assert.ok(lightAttrIdx !== -1, 'no :root[data-theme="light"] rule found');

test('the light :root block declares color-scheme:light dark', () => {
  assert.match(rootRule.body, /color-scheme:light dark/);
});

test('the dark media block is scoped to :not([data-theme="light"]), so an explicit light choice overrides the system preference', () => {
  assert.match(css.slice(mediaStart, mediaStart + 200), /:root:not\(\[data-theme="light"\]\)/);
});

test(':root[data-theme="dark"] declares color-scheme:dark and :root[data-theme="light"] declares color-scheme:light', () => {
  assert.match(darkAttrRule.body, /color-scheme:dark/);
  const lightRuleEnd = css.indexOf('}', lightAttrIdx);
  const lightRuleText = css.slice(lightAttrIdx, lightRuleEnd + 1);
  assert.match(lightRuleText, /color-scheme:light/);
});

test('all three color-bearing blocks (:root, the dark media block, :root[data-theme="dark"]) declare the exact same token name set', () => {
  const lightNames = tokenNames(rootRule.body);
  const mediaNames = tokenNames(mediaBlockOuter.body);
  const darkAttrNames = tokenNames(darkAttrRule.body);
  assert.ok(lightNames.length > 30, `expected a large token set, got ${lightNames.length}`);
  assert.deepStrictEqual(mediaNames, lightNames, 'the prefers-color-scheme dark block is missing/extra tokens vs :root');
  assert.deepStrictEqual(darkAttrNames, lightNames, ':root[data-theme="dark"] is missing/extra tokens vs :root');
});

test('the two dark blocks (media-query dark and [data-theme="dark"]) agree on every value, not just every name', () => {
  const mediaNames = tokenNames(mediaBlockOuter.body);
  mediaNames.forEach((name) => {
    const re = new RegExp(`--${name}:([^;}]+)(?:[;}]|$)`);
    const mVal = re.exec(mediaBlockOuter.body);
    const dVal = re.exec(darkAttrRule.body);
    assert.ok(mVal && dVal, `--${name} missing a value in one of the two dark blocks`);
    assert.strictEqual(mVal[1], dVal[1], `--${name} disagrees between the media-query dark block (${mVal[1]}) and [data-theme="dark"] (${dVal[1]})`);
  });
});

test('no color token is declared ONLY inside the dark media query — every dark-block name also exists on light :root', () => {
  const lightNames = new Set(tokenNames(rootRule.body));
  tokenNames(mediaBlockOuter.body).forEach((name) => {
    assert.ok(lightNames.has(name), `--${name} exists in the dark media block but not on :root`);
  });
});

// Spot-check exact values from the brief's token table (lowercase hex,
// rgba() spaced exactly as given) — by name, so a future conformance test
// comparing these blocks against skills/web/web/app.css by name has a
// stable contract to check against.
const SPOT_CHECKS = {
  paper: ['#f7f5f1', '#16141c'],
  surface: ['#ffffff', '#1e1b26'],
  ink: ['#241e33', '#ece8f4'],
  'ink-strong': ['#100a1f', '#faf8ff'],
  prose: ['#302a3d', '#dfdce7'],
  mut: ['#6e6880', '#9a93ac'],
  line: ['#e4dfea', '#2c2836'],
  'line-strong': ['#d3cedd', '#3c3847'],
  raised: ['#f4f2f8', '#26232f'],
  accent: ['#1b58a7', '#8cb8d9'],
  'accent-soft': ['#e1ebfa', '#1d2d39'],
  'code-ink': ['#724b2b', '#e0c6a3'],
  ok: ['#2e7d5b', '#5cc495'],
  warn: ['#966719', '#d9ae58'],
  'warn-soft': ['#fbf1e0', '#2a2114'],
  crit: ['#b4402f', '#e4816c'],
  'crit-soft': ['#fbe9e5', '#2d1517'],
  'on-fill': ['#ffffff', '#16141c'],
  'btn-bg': ['#efebf5', '#282334'],
  'btn-hover': ['#ddd6e6', '#363048'],
  'st-backlog': ['#0c5f65', '#39c5cf'],
  'st-todo': ['#0266d7', '#58a6ff'],
  'st-doing': ['#117a32', '#3fb950'],
  'st-done': ['#642cba', '#a371f7'],
  'st-archive': ['#626b75', '#868e9a'],
  'hash-a': ['#0266d7', '#58a6ff'],
  'hash-b': ['#117a32', '#3fb950'],
  'hash-c': ['#906001', '#d29922'],
  'hash-d': ['#642cba', '#a371f7'],
  'hash-e': ['#b93384', '#f778ba'],
  'hash-f': ['#0c5f65', '#39c5cf'],
  'hash-g': ['#b34906', '#f0883e'],
  'hash-h': ['#ce202d', '#ff7b72'],
  'id-high': ['#ce212d', '#f85149'],
  'id-waiting': ['#906001', '#d29922'],
  'id-review': ['#7d6400', '#eac54f'],
  'id-epic': ['#b34906', '#f0883e'],
  'blocked-ink': ['#b62324', '#fc6e63'],
  'blocked-bg': ['#fde8e6', '#3a1c21'],
  'review-ink': ['#7d6400', '#eac54f'],
  'review-bg': ['#fbf3c9', '#332b14'],
};

Object.entries(SPOT_CHECKS).forEach(([name, [light, dark]]) => {
  test(`--${name}: light=${light}, dark=${dark}`, () => {
    const re = new RegExp(`--${name}:([^;}]+)(?:[;}]|$)`);
    assert.strictEqual(re.exec(rootRule.body)[1], light, `--${name} light value`);
    assert.strictEqual(re.exec(mediaBlockOuter.body)[1], dark, `--${name} dark value (media)`);
    assert.strictEqual(re.exec(darkAttrRule.body)[1], dark, `--${name} dark value ([data-theme="dark"])`);
  });
});

test('epic-wash is the identical rgba() in both light and dark (per the brief\'s table)', () => {
  const re = /--epic-wash:([^;]+);/;
  const light = re.exec(rootRule.body)[1];
  const dark = re.exec(mediaBlockOuter.body)[1];
  assert.strictEqual(light, 'rgba(240, 136, 62, 0.12)');
  assert.strictEqual(dark, 'rgba(240, 136, 62, 0.12)');
});

test('shadow/scrim/shadow-pop use the exact rgba() spacing from the brief\'s table', () => {
  assert.match(rootRule.body, /--shadow:0 1px 2px rgba\(36, 30, 51, \.06\)/);
  assert.match(rootRule.body, /--scrim:rgba\(36, 30, 51, 0\.45\)/);
  assert.match(rootRule.body, /--shadow-pop:0 8px 24px rgba\(36, 30, 51, \.16\)/);
  assert.match(mediaBlockOuter.body, /--shadow:0 1px 2px rgba\(0, 0, 0, \.3\)/);
  assert.match(mediaBlockOuter.body, /--scrim:rgba\(0, 0, 0, 0\.6\)/);
  assert.match(mediaBlockOuter.body, /--shadow-pop:0 8px 24px rgba\(0, 0, 0, \.5\)/);
});

// --- the old two-state token names must be fully retired -------------------

test('none of the old two-state token names (--page,--ink2,--muted,--grid,--ring,--high,--bgd,--bgw,--rev,--bgr) survive anywhere in the file', () => {
  const oldNames = ['--page', '--ink2', '--muted', '--grid', '--ring', '--high', '--bgd', '--bgw', '--rev\\b', '--bgr'];
  oldNames.forEach((n) => {
    const re = new RegExp(n);
    assert.ok(!re.test(src), `old token ${n} still appears in build_editor.py`);
  });
});

test('the pillFlash keyframes\' fixed white-flash stops (kanban.proj #250: a deliberate, theme-invariant pairing) are untouched literals, not tokens', () => {
  const kfStart = css.indexOf('@keyframes pillFlash');
  const kfEnd = css.indexOf('}', css.indexOf('}', css.indexOf('}', kfStart) + 1) + 1);
  const kf = css.slice(kfStart, kfEnd + 1);
  assert.match(kf, /background:#fff;color:#3a0a0a/);
});
