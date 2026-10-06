const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { altitudeBadge, rollupSegments, rollupBar, rollupScopeLine, rollupDetailHtml, openLeavesWarning } = require('../web/rollup-bar');
const { rollupIndex } = require('../web/nesting');
const { statusColorClass, BUILTIN_STATUS_COLORS, STATUS_PALETTE } = require('../web/status-colors');

const ORDER = ['backlog', 'todo', 'doing', 'done'];
const roll = (counts, board = 'kanban') => {
  const c = Object.create(null);
  Object.assign(c, counts);
  return { total: Object.values(counts).reduce((a, b) => a + b, 0), counts: c, leaves: [], scope: { board } };
};

// --- the altitude badge -------------------------------------------------

test('altitudeBadge: a parent shows ▲n with its tooltip, a leaf shows nothing', () => {
  assert.strictEqual(altitudeBadge(2), '<span class="alt-badge" title="altitude: layers below">▲2</span>');
  assert.strictEqual(altitudeBadge(1), '<span class="alt-badge" title="altitude: layers below">▲1</span>');
  for (const none of [0, -1, undefined, null, NaN]) assert.strictEqual(altitudeBadge(none), '');
});

// --- segments and the bar -----------------------------------------------

test('rollupSegments follow the board\'s status order, then any other status by name', () => {
  const segs = rollupSegments(roll({ done: 2, zeta: 1, doing: 1, alpha: 4, backlog: 3 }).counts, ORDER);
  assert.deepStrictEqual(segs, [
    { status: 'backlog', n: 3 }, { status: 'doing', n: 1 }, { status: 'done', n: 2 },
    { status: 'alpha', n: 4 }, { status: 'zeta', n: 1 },
  ]);
});

test('rollupBar: collapsed is a thin bar of weighted segments with no numbers', () => {
  const html = rollupBar(roll({ done: 2, doing: 1, backlog: 1 }), 'collapsed', ORDER);
  assert.match(html, /^<div class="rollup"><div class="rollup-bar thin">/);
  const segs = [...html.matchAll(/<span class="rollup-seg rollup-seg--(\w[\w-]*)" data-n="(\d+)" title="([^"]*)"><\/span>/g)];
  assert.deepStrictEqual(segs.map((m) => [m[1], m[2], m[3]]), [
    ['backlog', '1', 'backlog: 1'], ['doing', '1', 'doing: 1'], ['done', '2', 'done: 2'],
  ]);
  assert.ok(!html.includes('rollup-count'), 'no counts line');
});

test('rollupBar: open adds the total, the done count, then each other status in its own colour', () => {
  const html = rollupBar(roll({ done: 9, doing: 2, todo: 3, backlog: 1 }), 'open', ORDER);
  assert.match(html, /<div class="rollup-bar">/);
  assert.match(html, /<b class="rollup-total">15<\/b>/);
  const items = [...html.matchAll(/<span class="rollup-count( rollup-count--[\w-]+)?">([^<]*)<\/span>/g)].map((m) => [m[1] || '', m[2]]);
  assert.deepStrictEqual(items, [
    ['', '9 done'], [' rollup-count--backlog', '1 backlog'], [' rollup-count--todo', '3 todo'], [' rollup-count--doing', '2 doing'],
  ]);
});

test('rollupBar: off, and a roll-up with nothing counted, draw nothing', () => {
  assert.strictEqual(rollupBar(roll({ done: 1 }), 'off', ORDER), '');
  assert.strictEqual(rollupBar(roll({}), 'open', ORDER), '');
  assert.strictEqual(rollupBar(roll({}), 'collapsed', ORDER), '');
});

test('rollupBar: a custom status colours through the same class family the status dot uses', () => {
  const html = rollupBar(roll({ 'in-review': 2 }), 'open', ORDER);
  const cls = statusColorClass('in-review');
  assert.ok(html.includes(`rollup-seg--${cls}`));
  assert.ok(html.includes(`rollup-count--${cls}`));
  assert.ok(html.includes('title="in-review: 2"'));
});

test('rollupBar: a hostile status stays escaped everywhere it is printed', () => {
  const html = rollupBar(roll({ '<img src=x onerror=alert(1)>': 1, '"><b>': 1 }), 'open', ORDER);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('"><b>'));
  assert.ok(html.includes('&lt;img'));
});

test('rollupBar never writes a style attribute: weights ride data-n for the CSSOM, colours ride classes', () => {
  for (const mode of ['open', 'collapsed']) {
    const html = rollupBar(roll({ done: 2, doing: 1, odd: 3 }), mode, ORDER);
    assert.ok(!/style\s*=/.test(html), `${mode} bar has no style attribute`);
    assert.ok(/data-n="3"/.test(html));
  }
});

// --- scope line and the detail block --------------------------------------

test('rollupScopeLine says the roll-up counted this board only, and names it', () => {
  assert.strictEqual(rollupScopeLine(roll({ done: 1 }, 'kanban'), true),
    'Counted on this board only (kanban). Archived leaves count as done.');
  assert.strictEqual(rollupScopeLine(roll({ done: 1 }, ''), true),
    'Counted on this board only. Archived leaves count as done.');
});

test('rollupScopeLine says when archived leaves were left out', () => {
  assert.strictEqual(rollupScopeLine(roll({ done: 1 }, 'kanban'), false),
    'Counted on this board only (kanban). Archived leaves are left out.');
});

test('the scope line is the same whatever the children say: it never claims other boards were counted', () => {
  const cards = [
    { id: 1, parent: null, status: 'todo' },
    { id: 2, parent: 1, status: 'done' },
    { id: 3, parent: 'fpp#1', status: 'done' },
  ];
  const r = rollupIndex(cards, { board: 'kanban' }).rollup(1);
  assert.match(rollupScopeLine(r, true), /^Counted on this board only \(kanban\)\./);
});

test('rollupDetailHtml: the open bar, then the scope line', () => {
  const html = rollupDetailHtml(roll({ done: 2, todo: 1 }), 2, ORDER, true);
  assert.match(html, /▲2/);
  assert.match(html, /<div class="rollup-bar">/);
  assert.match(html, /<b class="rollup-total">3<\/b>/);
  assert.ok(html.indexOf('rollup-scope') > html.indexOf('rollup-bar'), 'scope line comes after the bar');
  assert.match(html, /<div class="rollup-scope">Counted on this board only \(kanban\)\. Archived leaves count as done\.<\/div>/);
});

test('rollupDetailHtml: with nothing counted it says so and still names the scope', () => {
  const html = rollupDetailHtml(roll({}), 1, ORDER, false);
  assert.ok(!html.includes('rollup-bar'));
  assert.match(html, /No leaves counted\./);
  assert.match(html, /Archived leaves are left out\./);
});

test('the numbers of an open bar carry the scope in their tooltip, escaped; the thin bar has none to carry', () => {
  const open = rollupBar(roll({ done: 2, todo: 1 }), 'open', ORDER);
  assert.match(open, /<div class="rollup-counts" title="Counted on this board only \(kanban\)\.">/);
  assert.ok(!rollupBar(roll({ done: 2 }), 'collapsed', ORDER).includes('Counted on this board'));
  const hostile = rollupBar(roll({ done: 1 }, '"><img src=x>'), 'open', ORDER);
  assert.ok(!hostile.includes('<img'));
  assert.match(rollupBar(roll({ done: 1 }, ''), 'open', ORDER), /title="Counted on this board only\."/);
});

test('the board name in the scope line is escaped', () => {
  const html = rollupDetailHtml(roll({ done: 1 }, '<script>x</script>'), 1, ORDER, true);
  assert.ok(!html.includes('<script>'));
});

// --- the done warning -------------------------------------------------------

test('openLeavesWarning: lists each parent marked done that still has open leaves', () => {
  assert.strictEqual(openLeavesWarning([{ id: 6, open: 1 }, { id: 7, open: 2 }]),
    'Done with open leaves below: #6 (1 open), #7 (2 open)');
});

test('openLeavesWarning: parents with nothing open are left out, and nothing open means no warning', () => {
  assert.strictEqual(openLeavesWarning([{ id: 6, open: 0 }, { id: 7, open: 2 }]), 'Done with open leaves below: #7 (2 open)');
  assert.strictEqual(openLeavesWarning([{ id: 6, open: 0 }]), '');
  assert.strictEqual(openLeavesWarning([]), '');
});

// --- the stylesheet ---------------------------------------------------------

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

test('app.css paints one .rollup-seg-- and one .rollup-count-- rule per statusColorClass outcome, tokens only', () => {
  const tokenFor = (cls) => (cls.startsWith('palette-') ? `--hash-${require('../web/status-colors').HASH_SLOTS[Number(cls.slice(8))]}` : `--st-${cls}`);
  const classes = [...Object.keys(BUILTIN_STATUS_COLORS), 'archive', ...STATUS_PALETTE.map((_, i) => `palette-${i}`)];
  for (const cls of classes) {
    assert.ok(css.includes(`.rollup-seg--${cls} { background: var(${tokenFor(cls)});`), `segment rule: ${cls}`);
    assert.ok(css.includes(`.rollup-count--${cls} { color: var(${tokenFor(cls)});`), `count rule: ${cls}`);
  }
});

test('app.css gives the bar its shape: 8px open, 4px thin, weighted by flex-grow with no basis', () => {
  assert.match(css, /\.rollup-bar\s*\{[^}]*display:\s*flex[^}]*height:\s*8px/);
  assert.match(css, /\.rollup-bar\.thin\s*\{[^}]*height:\s*4px/);
  assert.match(css, /\.rollup-seg\s*\{[^}]*flex:\s*0 0 0/);
  for (const sel of ['.alt-badge', '.rollup-scope', '.rollup-count', '.rollup-total']) {
    const rule = css.match(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*\\}`));
    assert.ok(rule, `${sel} rule exists`);
    assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/, `${sel} uses tokens, not a hex`);
  }
});

test('the bar modes are named once, in column-state.js, and rollup-bar.js uses those names', () => {
  const columnState = require('../web/column-state');
  assert.deepStrictEqual([columnState.ROLLUP_BAR_OPEN, columnState.ROLLUP_BAR_COLLAPSED, columnState.ROLLUP_BAR_OFF], ['open', 'collapsed', 'off']);
  assert.deepStrictEqual(columnState.ROLLUP_BAR_MODES, ['open', 'collapsed', 'off']);
  const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'rollup-bar.js'), 'utf8')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  assert.doesNotMatch(code, /'open'|'collapsed'|'off'/);
  assert.match(code, /ROLLUP_COLUMN_STATE\.ROLLUP_BAR_OPEN/);
});
