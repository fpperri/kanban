const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban.proj#255 phase 3: shop status page style alignment ----------
// render.py (the shop status page's generator) and this app are two
// products, not one — a kanban board is a surface you grab things on, the
// status page is a still frame you read, and identical layout would be
// the wrong goal. What must be identical is the VOCABULARY: the same
// radius scale, the same label/number/link treatment, the same
// border-weight scale. This file pins that vocabulary, not the page's
// layout — see the spec at kanban.proj#255 phase 3 for the full mapping
// (transfers-wholesale / transfers-adapted / must-stay-different tables).

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

const SANS = 'ui-sans-serif,-apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
const MONO = 'ui-monospace,"Cascadia Mono",Consolas,"SF Mono",Menlo,monospace';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Nesting-aware brace matcher (same idiom as theme-tokens.test.js's block()).
function blockFrom(braceIdx) {
  let depth = 0;
  for (let i = braceIdx; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(braceIdx + 1, i);
    }
  }
  throw new Error('unbalanced braces from index ' + braceIdx);
}

// Finds ONE rule by its exact selector text, anchored at the start of a
// line so a short selector (.tag, .column-count) can't match as a
// substring of a longer compound one (.card-tags, .column.search-match
// .column-count) that merely contains it.
function ruleBlock(selector) {
  const re = new RegExp('(^|\\n)' + escapeRegex(selector) + ' \\{');
  const m = re.exec(css);
  assert.ok(m, `selector not found at line start: ${selector}`);
  const braceIdx = m.index + m[0].length - 1;
  return blockFrom(braceIdx);
}

test('the canonical font stacks appear verbatim, never a truncation', () => {
  const bodyBlock = ruleBlock('body');
  assert.ok(bodyBlock.includes(SANS), 'body carries the exact SANS stack');
  // Every font-family declaration naming a monospace fallback must be the
  // full canonical MONO string — this is the regression that already
  // happened once (`ui-monospace, Consolas, monospace`, a truncation).
  const re = /font-family:\s*([^;]+);/g;
  let m;
  let monoDeclCount = 0;
  while ((m = re.exec(css))) {
    const value = m[1].trim();
    if (/monospace/i.test(value)) {
      monoDeclCount++;
      assert.strictEqual(value, MONO, `truncated/drifted MONO stack: "${value}"`);
    }
  }
  assert.ok(monoDeclCount > 10, 'sanity: found the expected population of font-family: MONO declarations');
});

test('the radius scale is two values plus true circles', () => {
  const allowed = new Set(['.15rem', '.2rem', '.2rem .2rem 0 0', '50%', '0', '2px', '4px']);
  const re = /([a-zA-Z-]*radius):\s*([^;]+);/g;
  let m;
  let count = 0;
  while ((m = re.exec(css))) {
    count++;
    const value = m[2].trim();
    assert.ok(allowed.has(value), `unexpected radius value "${value}" for ${m[1]} — the radius scale is .15rem controls/.2rem panels/50% circles only, plus the gantt due diamond (2px), the OS scrollbar thumb (4px), and *-radius: 0 corner cuts`);
  }
  assert.ok(count > 30, 'sanity: found the expected population of radius declarations');
  // .column-header's top corners must track .column's own panel radius.
  const panel = ruleBlock('.column').match(/border-radius:\s*([^;]+);/)[1].trim();
  const headerRadius = ruleBlock('.column-header').match(/border-radius:\s*([^;]+);/)[1].trim();
  assert.strictEqual(headerRadius, `${panel} ${panel} 0 0`, '.column-header top corners must track .column\'s panel radius');
});

test('every number surface is mono + tabular', () => {
  const selectors = [
    '.card-id', '.column-count', '.bulk-tag-count', '.notif-badge', '.notif-meta',
    '.cal-chip-id', '.cal-day-num', '.cal-more', '.cal-tg-hour', '.gantt-week-mark',
    '.gantt-label-id', '.gantt-bar-id', '.map-node-id', '.dp-day', '.dp-time-input',
    '.card-schedule-row', '.detail-path', '.detail-frontmatter td.fm-value',
    '.detail-body .md-table .ta-right',
  ];
  for (const sel of selectors) {
    const b = ruleBlock(sel);
    assert.ok(b.includes(MONO), `${sel} is a number/quantity surface — must carry the MONO stack`);
    assert.ok(b.includes('font-variant-numeric: tabular-nums'), `${sel} is a number/quantity surface — must carry tabular-nums`);
  }
});

test('every label surface is uppercase + tracked, and no identity surface is', () => {
  const selectors = [
    '.modal label', '.column-name', '.cal-dow', '.dp-dow', '.cal-tg-dayhead',
    '.cal-tg-gutterlabel', '.gantt-row.gantt-group-row', '.detail-frontmatter td.fm-key',
    '.map-section-header', '.status-chip', '.tag',
  ];
  for (const sel of selectors) {
    const b = ruleBlock(sel);
    assert.match(b, /text-transform:\s*uppercase/, `${sel} is a category-word label — must be uppercase`);
    const m = /letter-spacing:\s*(-?[\d.]+)em/.exec(b);
    assert.ok(m, `${sel} is a category-word label — must carry a letter-spacing`);
    const tracking = parseFloat(m[1]);
    assert.ok(tracking >= 0.05 && tracking <= 0.13, `${sel} letter-spacing ${tracking}em out of the label band (0.05em-0.13em)`);
  }
  // Carve-outs: identities never get shouted, even when they sit inside a
  // labeled field or a table that otherwise carries the label treatment.
  const bulkTagRow = ruleBlock('.modal label.bulk-tag-row');
  assert.match(bulkTagRow, /text-transform:\s*none/, '.modal label.bulk-tag-row resets the shout — it wraps a real tag name');
  assert.match(bulkTagRow, /letter-spacing:\s*normal/, '.modal label.bulk-tag-row resets tracking too');
  const assignee = ruleBlock('.card-assignee');
  assert.ok(!/text-transform/.test(assignee), '.card-assignee is a human handle — never uppercase');
  const mdTableTh = ruleBlock('.detail-body .md-table th');
  assert.ok(!/text-transform/.test(mdTableTh), '.md-table th is author-typed markdown — never uppercase');
});

test('links are dotted borders, never underlines', () => {
  const a = ruleBlock('.detail-body a');
  assert.match(a, /text-decoration:\s*none/, 'no text-decoration on the base link');
  assert.match(a, /border-bottom:\s*1px dotted var\(--accent\)/, 'dotted border carries the link cue instead');
  const hover = ruleBlock('.detail-body a:hover');
  assert.match(hover, /border-bottom-style:\s*solid/, 'hover solidifies the dotted border');
  const focus = ruleBlock('.detail-body a:focus-visible');
  assert.match(focus, /outline:\s*2px solid var\(--accent\)/, 'focus-visible gets a real outline');
  assert.ok(!/text-decoration:\s*underline/.test(css), 'no text-decoration: underline anywhere in the file — the dotted-border idiom is the only link cue');
});

test('2px is reserved for the page boundary', () => {
  const header = ruleBlock('header');
  assert.match(header, /border-bottom:\s*2px solid var\(--ink\)/, 'header carries the 2px page-boundary rule');
  const allowlist = ['.gantt-today-line', '.cal-timeblock.point'];
  const re = /border(-top|-right|-bottom|-left)?(-width)?:\s*2px[^;]*;/g;
  let m;
  const offenders = [];
  while ((m = re.exec(css))) {
    // Walk back to find which rule this declaration sits inside.
    const before = css.slice(0, m.index);
    const lastOpenBrace = before.lastIndexOf('{');
    const selector = before.slice(before.lastIndexOf('\n', lastOpenBrace) + 1, lastOpenBrace).trim();
    if (selector === 'header' || allowlist.includes(selector)) continue;
    offenders.push(`${selector} { ${m[0]} }`);
  }
  assert.deepStrictEqual(offenders, [], '2px chrome borders found outside the header/allowlist (outline: 2px is a different channel and is fine; SVG stroke-width is a different channel entirely)');
});

test('state pills are a wash of their own colour, with no border', () => {
  for (const [sel, hex] of [['.blocked-pill', '#f85149'], ['.review-pill', '#eac54f']]) {
    const b = ruleBlock(sel);
    assert.match(b, /background:\s*rgba\(/, `${sel} carries an rgba() wash background`);
    assert.match(b, new RegExp('color:\\s*' + escapeRegex(hex)), `${sel} text colour is the same hue as its wash`);
    assert.ok(!/(^|[^-])border:/.test(b), `${sel} carries no border — a pill is a live state, not a static fact`);
  }
  // Chips are the opposite: a chip IS a bordered, neutral, static fact.
  for (const sel of ['.status-chip', '.tag']) {
    const b = ruleBlock(sel);
    assert.match(b, /border:\s*1px/, `${sel} is a chip — must carry a 1px border`);
    assert.match(b, /var\(--mut\)/, `${sel} is a chip — neutral colour, var(--mut)`);
  }
});
