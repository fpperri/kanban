const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- Contrast, computed from the tokens themselves ----------------------
// Every contrast figure quoted about this palette so far was worked out by
// hand and then carried into commit messages by copy. One of them was stale
// by the time it shipped: it had been measured against an earlier candidate
// pair, the pair changed, and the number did not. It survived because
// nothing recomputed it — a peer maintaining a mirror of this palette on
// another surface caught it by recomputing independently.
//
// So these read the hexes out of app.css and do the arithmetic. A number
// here cannot go stale, because there is no number here: only the ratios the
// tokens actually produce and the floors they have to clear.
//
// Floors are WCAG 2.1: 4.5:1 for normal text, 3.0:1 for large text and for
// non-text UI (borders, focus rings, chart marks).

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

function block(source, startIdx) {
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

function tokensOf(selector) {
  const at = css.indexOf(selector);
  assert.ok(at !== -1, `no ${selector} block in app.css`);
  const body = block(css, css.indexOf('{', at));
  const out = {};
  for (const m of body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// The light set is the bare :root; the dark set is the [data-theme="dark"]
// block, which by contract carries the same values as the media query.
const LIGHT = tokensOf(':root {');
const DARK = tokensOf(':root[data-theme="dark"]');

function srgb(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parse(value) {
  let m = /^#([0-9a-f]{6})$/i.exec(value);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return null;
}

// An alpha value has no contrast of its own — it has to be composited over
// the opaque surface that is guaranteed behind it (kanban.proj#255).
function over(fg, bg) {
  if (fg[3] === 1) return fg;
  return [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3]))).concat(1);
}

function lum(c) {
  return 0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
}

function ratio(set, fgTok, bgTok) {
  const bg = parse(set[bgTok]);
  assert.ok(bg, `${bgTok} is not a colour this test can parse: ${set[bgTok]}`);
  const fg = over(parse(set[fgTok]), bg);
  assert.ok(fg, `${fgTok} is not a colour this test can parse: ${set[fgTok]}`);
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const UI = 3.0;

// Body text and muted text, on both grounds a reader actually sees.
for (const [name, set] of [['light', LIGHT], ['dark', DARK]]) {
  test(`${name}: body ink clears ${TEXT}:1 on both paper and surface`, () => {
    for (const ground of ['--paper', '--surface']) {
      const r = ratio(set, '--ink', ground);
      assert.ok(r >= TEXT, `--ink on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: muted text clears ${TEXT}:1 on both paper and surface`, () => {
    for (const ground of ['--paper', '--surface']) {
      const r = ratio(set, '--mut', ground);
      assert.ok(r >= TEXT, `--mut on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  // The accent is a text colour wherever it is a link or a pressed control's
  // label, so it takes the text floor, not the UI one.
  test(`${name}: accent clears ${TEXT}:1 on paper, on surface, and on its own soft wash`, () => {
    for (const ground of ['--paper', '--surface', '--accent-soft']) {
      const r = ratio(set, '--accent', ground);
      assert.ok(r >= TEXT, `--accent on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: ok and crit clear ${TEXT}:1 on surface`, () => {
    for (const tok of ['--ok', '--crit']) {
      const r = ratio(set, tok, '--surface');
      assert.ok(r >= TEXT, `${tok} on --surface is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  // Rules and washes are non-text: they only have to be visible, not readable.
  test(`${name}: ordinary rules stay visible against the surfaces they divide`, () => {
    const r = ratio(set, '--line', '--surface');
    assert.ok(r >= 1.1, `--line on --surface is ${r.toFixed(2)}:1 — invisible`);
  });

  test(`${name}: the accent wash composites to something visible on paper`, () => {
    const bg = parse(set['--paper']);
    const washed = over(parse(set['--accent-wash']), bg);
    const a = lum(washed), b = lum(bg);
    const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(r >= 1.05, `--accent-wash over --paper is ${r.toFixed(2)}:1 — no visible change`);
  });

  // On-fill is the label colour for any control filled with a semantic colour.
  test(`${name}: on-fill text is readable on the accent and on the semantic trio`, () => {
    for (const tok of ['--accent', '--ok', '--crit']) {
      const r = ratio(set, '--on-fill', tok);
      assert.ok(r >= UI, `--on-fill on ${tok} is ${r.toFixed(2)}:1, under ${UI}`);
    }
  });
}

// The failure this file exists to prevent: the two dark blocks agreeing on
// their names but drifting on a value would give the OS-default reader and
// the explicit-toggle reader different contrast from the same stylesheet.
test('both dark blocks produce identical accent contrast — one dark palette, not two', () => {
  const at = css.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(at !== -1, 'no prefers-color-scheme block');
  const mq = block(css, css.indexOf('{', at));
  const inner = {};
  for (const m of mq.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) inner[m[1]] = m[2].trim();
  for (const ground of ['--paper', '--surface', '--accent-soft']) {
    const a = ratio(inner, '--accent', ground);
    const b = ratio(DARK, '--accent', ground);
    assert.ok(
      Math.abs(a - b) < 0.005,
      `accent on ${ground}: media query gives ${a.toFixed(2)}:1 but [data-theme] gives ${b.toFixed(2)}:1`,
    );
  }
});

// --warn is the one inherited token that does not clear the text floor in
// light, and it IS used as text (the stale-data indicator). Measured: 4.05:1
// on surface and 3.72:1 on paper, against a 4.5 floor. Darkening the light
// value about 6% would clear it (#9e6d1a gives 4.51:1), but this token is
// hand-mirrored onto another surface, so changing it is a shared decision and
// not this file's to take. Dark is unaffected at 8.18:1 and 8.82:1.
//
// These assert the CURRENT figures rather than the floor, so the debt is
// visible and cannot quietly get worse while it waits for that decision.
test('light: --warn is a known shortfall against the text floor, and no worse', () => {
  const onSurface = ratio(LIGHT, '--warn', '--surface');
  const onPaper = ratio(LIGHT, '--warn', '--paper');
  assert.ok(onSurface >= 4.0, `--warn on --surface fell to ${onSurface.toFixed(2)}:1`);
  assert.ok(onPaper >= 3.6, `--warn on --paper fell to ${onPaper.toFixed(2)}:1`);
  assert.ok(onSurface < TEXT, 'if --warn now clears 4.5:1 the shortfall is fixed — delete this test and put --warn back in the trio above');
});

test('dark: --warn clears the text floor comfortably', () => {
  assert.ok(ratio(DARK, '--warn', '--surface') >= TEXT);
  assert.ok(ratio(DARK, '--warn', '--paper') >= TEXT);
});
