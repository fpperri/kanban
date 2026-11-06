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

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8');

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

const PILLS = ['.status-pill'];

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

  test(`${name}: a parent on another board is muted text with a dashed edge, not opacity, and holds the floor on the canvas`, () => {
    for (const r of RULES) if (r.selectors.some((x) => x.startsWith('.map-node.external'))) assert.ok(!/(^|[;\s])opacity\s*:/.test(r.body), `${r.selectors} dims with opacity`);
    assert.ok(declsFor('.map-node.external rect')['stroke-dasharray']);
    for (const sel of ['.map-node.external .map-node-title', '.map-node.external .map-node-id']) {
      const tok = tokenIn(declsFor(sel).fill, sel);
      assert.strictEqual(tok, '--mut');
      clears(set, tok, '--surface', TEXT, sel);
    }
  });

  test(`${name}: the dashed edges that are decoration use the stronger line, and the external node's edge, the only cue it has, is a mark that clears ${UI}:1`, () => {
    assert.strictEqual(tokenIn(declsFor('.cal-day.outside')['border-color'], 'outside day edge'), '--line-strong');
    assert.strictEqual(tokenIn(declsFor('.notif-row.level-debug')['border-color'], 'debug row edge'), '--line-strong');
    const edge = tokenIn(declsFor('.map-node.external rect').stroke, 'external node edge');
    assert.strictEqual(edge, '--mut');
    clears(set, edge, '--surface', UI, 'external node edge');
  });

  test(`${name}: a map edge is a full-strength mark that clears ${UI}:1 on the canvas`, () => {
    const d = declsFor('.map-edge');
    assert.ok(!('opacity' in d) && !('stroke-opacity' in d), '.map-edge dims with opacity');
    clears(set, tokenIn(d.stroke, 'map edge'), '--surface', UI, 'map edge');
    clears(set, tokenIn(declsFor('#map-arrow path').fill, 'arrowhead'), '--surface', UI, 'arrowhead');
  });

  test(`${name}: the gantt today line is a full-strength accent mark on the surface`, () => {
    const d = declsFor('.gantt-today-line');
    assert.ok(!('opacity' in d), 'the today line dims with opacity');
    assert.match(d['border-left'], /var\(--accent\)/);
    clears(set, '--accent', '--surface', UI, 'gantt today line');
  });

  test(`${name}: an archived Graph dot keeps its status colour, which clears ${UI}:1, and is told apart by a dashed ring, not opacity`, () => {
    assert.deepStrictEqual(RULES.filter((r) => r.selectors.includes('.graph-node.archived')), [], 'an archived Graph node has a rule of its own that dims it');
    assert.ok(declsFor('.graph-node.archived .graph-dot')['stroke-dasharray'], 'an archived dot is ringed with dashes');
    for (const tok of Object.keys(set).filter((k) => /^--(st|hash)-/.test(k))) clears(set, tok, '--surface', UI, `archived Graph dot ${tok}`);
  });

  test(`${name}: an on or off filter pill's label is regular weight, only a soloed label is heavier`, () => {
    for (const sel of ['.status-pill', '.status-pill.off', '.query-pill', '.query-pill.on', '.query-pill-label']) {
      const w = (RULES.filter((r) => r.selectors.includes(sel)).map((r) => /font-weight\s*:\s*([^;]+)/.exec(r.body)).filter(Boolean).pop() || [])[1];
      assert.ok(w === undefined || w.trim() === '400' || w.trim() === 'normal', `${sel} sets font-weight ${w}`);
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

// The weight of a selector as the cascade counts it: classes, attributes and pseudo-classes, with :where() free.
function specificity(selector) {
  const bare = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  return (bare.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
}

test('the specificity count weighs a class, a pseudo-class and an attribute, and :where() nothing', () => {
  assert.strictEqual(specificity('.graph-node.archived.is-done .graph-dot'), 4);
  assert.strictEqual(specificity('.graph-node.archived:where(.is-done) .graph-dot'), 3);
  assert.strictEqual(specificity('.graph-node:focus-visible .graph-dot'), 3);
  assert.strictEqual(specificity('[tabindex="-1"]:focus-visible'), 2);
});

// An archived done dot keeps its own colour's ring, but its rule must not outweigh the states a dot shows (selected,
// hovered, focused): those are drawn with the same stroke property, and the focus ring is the only cue a Graph node has.
test("the archived done dot's ring never outweighs the selected, hovered and focused strokes, and comes before them", () => {
  const ring = RULES.find((r) => r.selectors.some((s) => /archived[^,]*is-done[^,]*\.graph-dot$/.test(s)));
  assert.ok(ring, 'a rule rings an archived done dot');
  const ringSel = ring.selectors.find((s) => /archived[^,]*is-done[^,]*\.graph-dot$/.test(s));
  for (const state of ['.graph-node.selected .graph-dot', '.graph-node.hover-highlight .graph-dot', '.graph-node:focus-visible .graph-dot']) {
    const rule = RULES.find((r) => r.selectors.includes(state));
    assert.ok(rule, `no rule for ${state}`);
    assert.ok(specificity(ringSel) <= specificity(state), `${ringSel} outweighs ${state}`);
    assert.ok(RULES.indexOf(ring) < RULES.indexOf(rule), `${ringSel} comes after ${state}`);
  }
});

test('a parent line to a parent on another board has a dash of its own, told apart from a live parent line', () => {
  const dash = (sel) => declsFor(sel)['stroke-dasharray'];
  const parent = dash('.map-parent-line');
  const external = dash('.map-parent-line.external-edge');
  assert.ok(external, 'a parent line to a parent on another board is dashed');
  assert.notStrictEqual(external, parent);
  const at = (sel) => css.indexOf(sel + ' {');
  assert.ok(at('.map-parent-line.external-edge') > at('.map-parent-line'), 'it comes after the rule it overrides');
});

// Every way a stylesheet can dim: opacity, and its paint twins fill-opacity and stroke-opacity, to anything under 1.
const DIM = /(^|[;\s])(fill-|stroke-)?opacity\s*:(?!\s*1\s*(;|$))/;

// The Graph's rules that keep an opacity, each with why it is not a dimmed live mark or text. The Graph's links
// and dimming wait on a ruling, so they are listed, not fixed. A rule that is not here fails the scan, and a name
// here that no rule has fails the second test.
const GRAPH_KEEPS = {
  '.graph-tint': 'a wash behind the tiers, read by its shape',
  '.graph-guide': 'a guide ring, decoration',
  '.graph-guide-sub': 'a guide ring, decoration',
  '.graph-divider': 'a divider, decoration',
  '.graph-link-parent': 'a link: waits on the ruling about the Graph\'s links',
  '.graph-link-wait': 'a link: waits on the ruling about the Graph\'s links',
  '.graph-link-counted': 'a link: waits on the ruling about the Graph\'s links',
  '.graph-flow-col': 'a flow column wash, decoration',
  '.graph-flow-col-alt': 'a flow column wash, decoration',
  '.graph-flow-strip': 'a flow strip ground, decoration',
  '.graph-flow-lane': 'a flow lane ground, decoration',
  '.graph-flow-faded': 'the Graph\'s dimming: waits on the ruling',
  '.graph-canvas.graph-flow-frontier .graph-node.is-done': 'the Graph\'s dimming: waits on the ruling',
  '.graph-canvas.graph-flow-frontier .graph-node.archived': 'the Graph\'s dimming: waits on the ruling',
  '.graph-node-leader': 'a leader line, decoration',
  '.graph-dim .graph-node:not(.graph-near)': 'the Graph\'s dimming: waits on the ruling',
  '.graph-dim .graph-link:not(.graph-near)': 'the Graph\'s dimming: waits on the ruling',
  '.graph-dim .graph-link.graph-near': 'the Graph\'s dimming: waits on the ruling',
  '.graph-dim .graph-link:not(.graph-near) + .graph-link-count': 'the Graph\'s dimming: waits on the ruling',
};

function dimmers(rules) {
  const out = [];
  for (const r of rules) if (DIM.test(r.body)) for (const s of r.selectors) out.push(s);
  return out;
}

test('no rule dims live text or a resting mark with opacity, fill-opacity or stroke-opacity, the Graph\'s included', () => {
  // Disabled and dragging states are transient; the prompt-fallback titles are italic text on their own ground
  // (the Map's, the Calendar's and the board's alike).
  const NOT_TEXT = /:disabled|\.dragging|--prompt-fallback/;
  const offenders = dimmers(RULES).filter((s) => !NOT_TEXT.test(s) && !(s in GRAPH_KEEPS));
  assert.deepStrictEqual(offenders, []);
});

test('the Graph\'s kept opacities are exactly the ones listed, none of them stale', () => {
  const graph = dimmers(RULES).filter((s) => /^\.graph-/.test(s));
  assert.deepStrictEqual([...new Set(graph)].sort(), Object.keys(GRAPH_KEEPS).sort());
});

test('the opacity scan catches the paint twins and a Graph selector', () => {
  const rules = [
    { selectors: ['.x'], body: 'fill-opacity: .5;' },
    { selectors: ['.y'], body: 'stroke-opacity: .5;' },
    { selectors: ['.graph-z'], body: 'opacity: .5;' },
    { selectors: ['.ok'], body: 'fill: red; stroke-width: 1px;' },
    { selectors: ['.full'], body: 'opacity: 1; fill-opacity: 1;' },
    { selectors: ['.full'], body: 'opacity: 1; fill-opacity: 1;' },
  ];
  assert.deepStrictEqual(dimmers(rules), ['.x', '.y', '.graph-z']);
});

// A page script may set an element's style, but never dims one. The app builds its elements by several routes: the
// style property, an attribute map handed to graphEl, setAttribute, and markup strings. So the scan looks for the word
// in every page script and page, comments stripped: none of them has a reason to name opacity.
const WEB_DIR = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const SCRIPT_DIM = /(fill-|stroke-|fill|stroke)?opacity/gi;
const withoutComments = (text, html) => (html ? text.replace(/<!--[\s\S]*?-->/g, '') : text)
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('no page script or page names opacity, fill-opacity or stroke-opacity', () => {
  const offenders = [];
  for (const f of fs.readdirSync(WEB_DIR).filter((n) => /\.(js|html)$/.test(n))) {
    const text = withoutComments(fs.readFileSync(path.join(WEB_DIR, f), 'utf8'), f.endsWith('.html'));
    for (const m of text.matchAll(SCRIPT_DIM)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('the script opacity scan catches each way a script can dim', () => {
  for (const line of [
    'el.style.opacity = ".5"', 'g.style.fillOpacity = ".5"', 'g.style.strokeOpacity=".5"', 'el.style.cssText="color:red;opacity:.5"',
    'el.style.cssText+=";fill-opacity:.5"', 'el.style.setProperty("opacity", ".5")', 'el.style.setProperty("stroke-opacity", ".5")',
    'el.setAttribute("opacity", ".5")', 'el.setAttribute("fill-opacity", ".5")', 'el.style["opacity"]=".5"',
    'Object.assign(el.style,{opacity:".5"})', "graphEl('path', { 'stroke-opacity': 0.5 }, 'graph-link')",
    "graphEl('path', { opacity: 0.5 }, 'x')", 'html = `<path stroke-opacity="0.5">`', '<circle fill-opacity="0.4"></circle>',
  ]) {
    assert.ok(line.match(SCRIPT_DIM), line);
  }
  assert.strictEqual('el.style.color = "red"'.match(SCRIPT_DIM), null);
  assert.strictEqual(withoutComments('// opacity here\n/* and opacity here */\nel.hidden = true', false).match(SCRIPT_DIM), null);
});

test('a code block sits on the raised ground, as the stylesheet says, and its ink holds the floor there', () => {
  assert.strictEqual(tokenIn(declsFor('.detail-body pre').background, 'code block ground'), '--raised');
  for (const set of [LIGHT, DARK]) clears(set, '--code-ink', '--raised', TEXT, 'code block');
});

// --- the coloured Markdown boxes (markdown-edit-ui.js) ---------------------------------------
// A kind's colour is drawn on the box's paper; the selection wash is drawn over the copy, so the
// text under a selection is read on the paper with the wash composited over it. A token may name
// another (`var(--mut)`), so the pairs are resolved before they are measured.

const MD_EDIT_KINDS = ['heading', 'heading-six', 'bold', 'italic', 'strike', 'code', 'link', 'marker', 'tag', 'mention'];

function colourOf(set, tok) {
  let value = set[tok];
  for (let i = 0; i < 4 && value; i++) {
    const m = /^var\((--[a-z-]+)\)$/.exec(value);
    if (!m) break;
    value = set[m[1]];
  }
  const c = parse(value);
  assert.ok(c, `${tok} is not a colour this test can resolve: ${set[tok]}`);
  return c;
}

function ratioOfColours(fg, bg) {
  const a = lum(over(fg, bg));
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const [name, set] of [['light', LIGHT], ['dark', DARK]]) {
  test(`${name}: every Markdown edit colour clears ${TEXT}:1 on the box's paper`, () => {
    for (const kind of MD_EDIT_KINDS) {
      const tok = `--md-edit-${kind}`;
      const r = ratioOfColours(colourOf(set, tok), colourOf(set, '--paper'));
      assert.ok(r >= TEXT, `${tok} on --paper is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: a mention clears ${TEXT}:1 on its own ground`, () => {
    const r = ratioOfColours(colourOf(set, '--md-edit-mention'), colourOf(set, '--md-edit-mention-bg'));
    assert.ok(r >= TEXT, `--md-edit-mention on --md-edit-mention-bg is ${r.toFixed(2)}:1, under ${TEXT}`);
  });

  test(`${name}: preview bold clears ${TEXT}:1 on the surface and on the raised ground`, () => {
    for (const ground of ['--surface', '--raised']) {
      const r = ratioOfColours(colourOf(set, '--md-preview-bold'), colourOf(set, ground));
      assert.ok(r >= TEXT, `--md-preview-bold on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  test(`${name}: the preview mention clears ${TEXT}:1 on its own ground, and the ground is the accent wash`, () => {
    assert.strictEqual(set['--mention-bg'], 'var(--accent-soft)');
    const r = ratioOfColours(colourOf(set, '--mention'), colourOf(set, '--mention-bg'));
    assert.ok(r >= TEXT, `--mention on --mention-bg is ${r.toFixed(2)}:1, under ${TEXT}`);
  });

  test(`${name}: the Markdown edit colours and the mention have their own values, apart from the accent`, () => {
    assert.strictEqual(set['--md-edit-bold'], name === 'light' ? '#263d51' : '#bdd9e7');
    assert.strictEqual(set['--md-edit-italic'], name === 'light' ? '#4a5d71' : '#96afbd');
    assert.strictEqual(set['--md-preview-bold'], set['--md-edit-bold']);
    assert.strictEqual(set['--md-edit-mention'], name === 'light' ? '#7f584d' : '#b89689');
    assert.strictEqual(set['--md-edit-mention-bg'], name === 'light' ? '#f9ece6' : '#261e1b');
    assert.strictEqual(set['--mention'], name === 'light' ? '#8d5044' : '#ca8975');
  });

  test(`${name}: the preview heading clears ${TEXT}:1 on the surface and on the raised ground`, () => {
    for (const ground of ['--surface', '--raised']) {
      const r = ratioOfColours(colourOf(set, '--md-preview-heading'), colourOf(set, ground));
      assert.ok(r >= TEXT, `--md-preview-heading on ${ground} is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
  });

  // The wash is drawn over the copy, which is drawn over the paper: what is read is the text colour under the
  // wash, on the paper under the wash.
  test(`${name}: every Markdown edit colour still clears ${TEXT}:1 under the box's selection wash`, () => {
    const wash = colourOf(set, '--md-edit-selection');
    assert.ok(wash[3] < 1, 'the selection wash has an alpha of its own');
    const paper = colourOf(set, '--paper');
    const washedPaper = over(wash, paper);
    for (const kind of MD_EDIT_KINDS.filter((k) => k !== 'mention')) {
      const tok = `--md-edit-${kind}`;
      const r = ratioOfColours(over(wash, colourOf(set, tok)), washedPaper);
      assert.ok(r >= TEXT, `${tok} under the wash on the washed paper is ${r.toFixed(2)}:1, under ${TEXT}`);
    }
    const chip = over(wash, colourOf(set, '--md-edit-mention-bg'));
    const mention = ratioOfColours(over(wash, colourOf(set, '--md-edit-mention')), chip);
    assert.ok(mention >= TEXT, `--md-edit-mention under the wash on the washed chip is ${mention.toFixed(2)}:1, under ${TEXT}`);
    const plain = ratioOfColours(over(wash, colourOf(set, '--ink')), washedPaper);
    assert.ok(plain >= TEXT, `--ink under the wash on the washed paper is ${plain.toFixed(2)}:1, under ${TEXT}`);
  });

  // A link's dotted border is a mark, not text: the 3:1 floor, on the paper and under the wash.
  test(`${name}: a link's dotted border clears ${UI}:1 on the paper and under the selection wash`, () => {
    const link = colourOf(set, '--md-edit-link');
    const paper = colourOf(set, '--paper');
    const wash = colourOf(set, '--md-edit-selection');
    const plain = ratioOfColours(link, paper);
    assert.ok(plain >= UI, `--md-edit-link on --paper is ${plain.toFixed(2)}:1, under ${UI}`);
    const washed = ratioOfColours(over(wash, link), over(wash, paper));
    assert.ok(washed >= UI, `--md-edit-link under the wash is ${washed.toFixed(2)}:1, under ${UI}`);
  });

  test(`${name}: the shared accent wash is not the box's selection, which has to keep muted and accent text readable`, () => {
    assert.notStrictEqual(set['--md-edit-selection'], set['--accent-wash']);
  });
}
