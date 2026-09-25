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

// OKLab (Ottosson 2020): perceived lightness and hue distance, for the checks
// that are about hierarchy rather than legibility.
function oklab(c) {
  const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const [r, g, b] = c.slice(0, 3).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
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

  // --warn is text too (the stale-data indicator sits on paper in the header).
  test(`${name}: ok, warn and crit clear ${TEXT}:1 on surface and on paper`, () => {
    for (const tok of ['--ok', '--warn', '--crit']) {
      for (const ground of ['--surface', '--paper']) {
        const r = ratio(set, tok, ground);
        assert.ok(r >= TEXT, `${tok} on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
      }
    }
  });

  // A warning or error row sits on its soft ground, and anything written in
  // the row's own colour sits on it too.
  test(`${name}: warn and crit clear ${TEXT}:1 on their own soft grounds`, () => {
    for (const [tok, ground] of [['--warn', '--warn-soft'], ['--crit', '--crit-soft']]) {
      const r = ratio(set, tok, ground);
      assert.ok(r >= TEXT, `${tok} on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  // --- the reading layer: card bodies and notifications -----------------
  test(`${name}: prose clears ${TEXT}:1 on paper (notification rows) and surface (card bodies)`, () => {
    for (const ground of ['--paper', '--surface']) {
      const r = ratio(set, '--prose', ground);
      assert.ok(r >= TEXT, `--prose on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: code ink clears ${TEXT}:1 on its own ground and on both page grounds`, () => {
    for (const ground of ['--raised', '--paper', '--surface']) {
      const r = ratio(set, '--code-ink', ground);
      assert.ok(r >= TEXT, `--code-ink on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: table headers (muted text on the raised ground) clear ${TEXT}:1`, () => {
    const r = ratio(set, '--mut', '--raised');
    assert.ok(r >= TEXT, `--mut on --raised is ${r.toFixed(2)}:1, under ${TEXT}`);
  });

  test(`${name}: the strong rule and the raised ground stay visible on surface`, () => {
    const rule = ratio(set, '--line-strong', '--surface');
    assert.ok(rule >= 1.3, `--line-strong on --surface is ${rule.toFixed(2)}:1, too faint to read as a rule`);
    const ground = ratio(set, '--raised', '--surface');
    assert.ok(ground >= 1.05, `--raised on --surface is ${ground.toFixed(2)}:1, no visible ground`);
  });

  // The defect this layer fixes: headings, prose and code all painted --ink,
  // so a body had one lightness and read flat. These keep the steps apart.
  test(`${name}: headings, prose, code and muted text sit on separate lightness steps`, () => {
    const L = (tok) => oklab(parse(set[tok]))[0];
    const head = L('--ink-strong'), prose = L('--prose'), mut = L('--mut');
    assert.ok(Math.abs(head - prose) >= 0.06, `--ink-strong and --prose are only ${Math.abs(head - prose).toFixed(3)} apart in lightness`);
    assert.ok(Math.abs(prose - mut) >= 0.15, `--prose and --mut are only ${Math.abs(prose - mut).toFixed(3)} apart in lightness`);
    const [p, c] = [oklab(parse(set['--prose'])), oklab(parse(set['--code-ink']))];
    const dE = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    assert.ok(dE >= 0.06, `--code-ink is only ${dE.toFixed(3)} from --prose (OKLab), so code reads as prose`);
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
