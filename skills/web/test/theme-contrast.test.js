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

  // --- status identity: column headers, assignee chips, badges and dates are
  // text, so every identity token takes the text floor on each ground it paints
  // on in its own theme (surface, paper, and the chip ground --btn-bg).
  test(`${name}: every status and identity colour clears ${TEXT}:1 as text on surface, paper and the chip ground`, () => {
    const ids = Object.keys(set).filter((k) => /^--(st|hash|id)-/.test(k) && !k.endsWith('-hover'));
    assert.ok(ids.length >= 16, `expected the identity tokens, found ${ids.length}`);
    for (const tok of ids) {
      for (const ground of ['--surface', '--paper', '--btn-bg']) {
        const r = ratio(set, tok, ground);
        assert.ok(r >= TEXT, `${tok} on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
      }
    }
  });

  // A sticker's ground is its own token, never a tint of its ink, so the pair
  // is checked directly: on its ground, over whichever page ground it sits on.
  test(`${name}: blocked and review stickers clear ${TEXT}:1 on their own grounds`, () => {
    for (const s of ['blocked', 'review']) {
      for (const page of ['--paper', '--surface']) {
        const bg = over(parse(set[`--${s}-bg`]), parse(set[page]));
        const fg = over(parse(set[`--${s}-ink`]), bg);
        const a = lum(fg), b = lum(bg);
        const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(r >= TEXT, `--${s}-ink on --${s}-bg over ${page} is ${r.toFixed(2)}:1, under ${TEXT}`);
      }
    }
  });

  // The gantt due diamond's hover twins are marks, not text: the 3:1 floor.
  test(`${name}: the due diamond's hover colours stay visible on surface and paper`, () => {
    for (const tok of ['--id-high-hover', '--id-waiting-hover']) {
      for (const ground of ['--surface', '--paper']) {
        const r = ratio(set, tok, ground);
        assert.ok(r >= UI, `${tok} on ${ground} is ${r.toFixed(2)}:1, under ${UI}`);
      }
    }
  });

  test(`${name}: the review pill's ink is the review identity itself`, () => {
    assert.strictEqual(set['--review-ink'], set['--id-review']);
  });

  test(`${name}: on-fill labels stay readable on every solid status fill`, () => {
    for (const tok of Object.keys(set).filter((k) => /^--(st|hash)-/.test(k))) {
      const r = ratio(set, '--on-fill', tok);
      assert.ok(r >= TEXT, `--on-fill on ${tok} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
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

// --- floors from the shop's visual standard, checked on the rules themselves ---
// Each test reads the declaration the stylesheet actually paints and computes
// the pair from the tokens, so a rule that is changed back to a failing colour
// (or to opacity) fails here rather than in a reviewer's eye.

const RULES = [];
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  RULES.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] });
}

function declsFor(selector) {
  const found = RULES.filter((r) => r.selectors.includes(selector));
  assert.ok(found.length, `no rule for ${selector} in app.css`);
  const out = {};
  for (const r of found) for (const d of r.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);?/g)) out[d[1]] = d[2].trim();
  return out;
}

function tokenIn(value, what) {
  const m = /var\((--[a-z-]+)\)/.exec(value || '');
  assert.ok(m, `${what} is not a var(--token): ${value}`);
  return m[1];
}

function clears(set, fg, bg, floor, what) {
  const r = ratio(set, fg, bg);
  assert.ok(r >= floor, `${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1, under ${floor}`);
}

const PILLS = ['.map-filter-toggle', '.gantt-filter-toggle', '.calendar-filter-toggle', '.graph-filter-toggle'];

for (const [name, set] of [['light', LIGHT], ['dark', DARK]]) {
  test(`${name}: an off filter pill is muted text with a strike-through, never opacity, and holds the floor on its ground and its hover`, () => {
    for (const p of PILLS) {
      const off = declsFor(`${p}.off`);
      assert.ok(!('opacity' in off), `${p}.off dims with opacity`);
      assert.match(off['text-decoration'] || '', /line-through/, `${p}.off is not struck through`);
      assert.ok(!/dashed/.test(off['border-style'] || ''), `${p}.off carries a dashed edge, a state the standard does not have`);
      const ink = tokenIn(off.color, `${p}.off colour`);
      assert.strictEqual(ink, '--mut');
      const hover = declsFor(`${p}:hover`);
      const hoverGround = tokenIn(hover.background, `${p}:hover ground`);
      assert.strictEqual(hoverGround, '--btn-bg');
      clears(set, ink, tokenIn(declsFor(p).background, `${p} ground`), TEXT, `${p}.off`);
      clears(set, ink, hoverGround, TEXT, `${p}.off:hover`);
    }
  });

  test(`${name}: copy feedback leaves the label ink and rides the border, which clears the mark floor on both button grounds`, () => {
    for (const [cls, border] of [['copy-success', '--ok'], ['copy-failed', '--crit']]) {
      const d = declsFor(`#detail-copy-btn.${cls}`);
      assert.ok(!('color' in d), `#detail-copy-btn.${cls} recolours the label`);
      assert.strictEqual(tokenIn(d['border-color'], `${cls} border`), border);
      for (const ground of ['--btn-bg', '--btn-hover']) clears(set, border, ground, UI, `${cls} border`);
    }
    for (const ground of ['--btn-bg', '--btn-hover']) clears(set, '--ink', ground, TEXT, 'copy label');
  });

  test(`${name}: on a card's hover wash the id, tags, dates and overdue date use only wash-safe inks`, () => {
    const ground = '--hover-wash';
    for (const [sel, allowed] of [
      ['.card.hover-highlight .card-id', ['--ink']],
      ['.card.hover-highlight .tag', ['--ink']],
      ['.card.hover-highlight .card-schedule-row', ['--ink']],
      ['.card.hover-highlight .card-schedule-row.overdue', ['--ink-strong']],
      ['.card.hover-highlight .alt-badge', ['--ink']],
      ['.card.hover-highlight .rollup-counts', ['--ink']],
      ['.card.hover-highlight .rollup-count', ['--ink']],
      ['.card.hover-highlight .waiting-badge', ['--ink']],
      ['.card.hover-highlight [class*="assignee-text--palette"]', ['--ink']],
      ['.map-node.hover-highlight .alt-badge', ['--ink']],
      ['.map-node.hover-highlight .rollup-counts', ['--ink']],
      ['.map-node.hover-highlight .rollup-count', ['--ink']],
      ['.map-node.hover-highlight [class*="assignee-text--palette"]', ['--ink']],
      ['.cal-chip.hover-highlight .cal-chip-id', ['--ink']],
      ['.gantt-bar.hover-highlight .gantt-bar-id', ['--ink']],
      ['.gantt-label.hover-highlight .gantt-label-id', ['--ink']],
    ]) {
      const tok = tokenIn(declsFor(sel).color, sel);
      assert.ok(allowed.includes(tok), `${sel} uses ${tok}`);
      clears(set, tok, ground, TEXT, sel);
    }
  });

  test(`${name}: a map node's id reads ink on the hover wash`, () => {
    const d = declsFor('.map-node.hover-highlight .map-node-id');
    clears(set, tokenIn(d.fill, 'map id fill'), '--hover-wash', TEXT, 'map node id');
  });

  test(`${name}: an outside date reads ink on the picker's hover ground`, () => {
    const hov = declsFor('.dp-day.outside:hover');
    const wash = parse(set[tokenIn(declsFor('.dp-day:hover').background, 'dp hover ground')]);
    const ground = over(wash, parse(set['--surface']));
    const ink = parse(set[tokenIn(hov.color, 'outside hover ink')]);
    const r = (Math.max(lum(ink), lum(ground)) + 0.05) / (Math.min(lum(ink), lum(ground)) + 0.05);
    assert.ok(r >= TEXT, `.dp-day.outside:hover is ${r.toFixed(2)}:1 on the wash over the popup, under ${TEXT}`);
  });

  test(`${name}: outside-month calendar days stay distinct without opacity: muted number against ink, raised ground, dashed edge, chips unchanged`, () => {
    const outside = declsFor('.cal-day.outside');
    assert.ok(!('opacity' in outside));
    assert.match(outside['border-style'] || '', /dashed/);
    assert.strictEqual(tokenIn(declsFor('.cal-day-num').color, 'in-month number'), '--ink');
    const num = tokenIn(declsFor('.cal-day.outside .cal-day-num').color, 'outside number');
    assert.strictEqual(num, '--mut');
    clears(set, num, tokenIn(outside.background, 'outside ground'), TEXT, 'outside day number');
    clears(set, '--mut', '--surface', TEXT, 'chip id inside an outside day');
  });

  test(`${name}: a debug notification recedes by muted headline and message plus a dashed edge`, () => {
    assert.match(declsFor('.notif-row.level-debug')['border-style'] || '', /dashed/);
    for (const sel of ['.notif-row.level-debug .notif-tldr', '.notif-row.level-debug .notif-message']) {
      const tok = tokenIn(declsFor(sel).color, sel);
      assert.strictEqual(tok, '--mut');
      clears(set, tok, '--paper', TEXT, sel);
    }
  });

  test(`${name}: a ghost map stub is muted text with a dashed edge, not opacity, and holds the floor on the canvas`, () => {
    for (const r of RULES) if (r.selectors.some((x) => x.startsWith('.map-node.ghost'))) assert.ok(!/(^|[;\s])opacity\s*:/.test(r.body), `${r.selectors} dims with opacity`);
    assert.ok(declsFor('.map-node.ghost rect')['stroke-dasharray']);
    for (const sel of ['.map-node.ghost .map-node-title', '.map-node.ghost .map-node-id']) {
      const tok = tokenIn(declsFor(sel).fill, sel);
      assert.strictEqual(tok, '--mut');
      clears(set, tok, '--paper', TEXT, sel);
    }
  });

  test(`${name}: the Children toggle's label and count hold the floor on the button hover ground`, () => {
    for (const sel of ['.relatives-toggle:hover .relatives-label', '.relatives-toggle:hover .relatives-count']) {
      clears(set, tokenIn(declsFor(sel).color, sel), '--btn-hover', TEXT, sel);
    }
  });

  test(`${name}: a selected date keeps its own pair on hover`, () => {
    const sel = declsFor('.dp-day.selected');
    const hov = declsFor('.dp-day.selected:hover');
    assert.strictEqual(tokenIn(hov.background, 'hover ground'), tokenIn(sel.background, 'selected ground'));
    clears(set, tokenIn(sel.color, 'selected ink'), tokenIn(hov.background, 'hover ground'), TEXT, '.dp-day.selected:hover');
  });

  test(`${name}: dimmed-by-colour states hold the floor on their grounds`, () => {
    clears(set, tokenIn(declsFor('.dp-day.outside').color, 'dp outside'), '--paper', TEXT, '.dp-day.outside');
    clears(set, tokenIn(declsFor('.notif-row.level-debug .notif-message').color, 'debug message'), '--paper', TEXT, 'debug notification');
    clears(set, '--mut', tokenIn(declsFor('.cal-day.outside').background, 'cal outside ground'), TEXT, '.cal-day.outside day number');
  });
}

test('no rule dims live text with opacity', () => {
  // --prompt-fallback: the italic stand-in for an empty title keeps its dimming; its worst ratio is 7.09:1, far above the floor.
  const NOT_TEXT = /:disabled|\.dragging|^\.graph-|\.gantt-today-line|--prompt-fallback/;
  const offenders = [];
  for (const r of RULES) {
    if (!/(^|[;\s])opacity\s*:/.test(r.body)) continue;
    for (const s of r.selectors) if (!NOT_TEXT.test(s)) offenders.push(s);
  }
  assert.deepStrictEqual(offenders, []);
});

test('a code block sits on the raised ground, as the stylesheet says, and its ink holds the floor there', () => {
  assert.strictEqual(tokenIn(declsFor('.detail-body pre').background, 'code block ground'), '--raised');
  for (const set of [LIGHT, DARK]) clears(set, '--code-ink', '--raised', TEXT, 'code block');
});
