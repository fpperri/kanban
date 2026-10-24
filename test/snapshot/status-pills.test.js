const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { board, open } = require('./nesting-view');
const { withSnapshot } = require('./nesting-fixture');
const { byClass, loadPage } = require('./page-harness');

const withMouse = (b, fn) => withSnapshot(b, (html) => fn(loadPage(html, { matchMedia: (q) => q.includes('min-width:900px') || q.includes('pointer: fine') })));

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts', 'build_editor.py'), 'utf8');
const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

function decls(selector) {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector));
  assert.ok(found.length, `no rule for ${selector}`);
  const out = {};
  for (const m of found) for (const d of m[2].matchAll(/([a-z-]+):([^;]+)/g)) out[d[1]] = d[2].trim();
  return out;
}

test('an off status pill is muted, struck through and hollow, with no opacity and a button hover', () => {
  const off = decls('.pillrow button.off');
  assert.ok(!('opacity' in off), 'dims with opacity');
  assert.strictEqual(off.color, 'var(--mut)');
  assert.match(off['text-decoration'] || '', /line-through/);
  assert.strictEqual(decls('.pillrow button:hover').background, 'var(--btn-bg)');
  assert.strictEqual(decls('.pillrow button.off .dot').background, 'transparent');
});

test('the open card sits on the surface ground and code blocks on the raised one', () => {
  assert.strictEqual(decls('#modalscroll').background, 'var(--surface)');
  assert.strictEqual(decls('.bodymd pre').background, 'var(--raised)');
});

const BOARD = board('', [[1, 'todo', 'One'], [2, 'done', 'Two']]);
const pills = (page) => byClass(page.byId('boardpills'), 'pillrow')[0].children;
const state = (page) => pills(page).map((b) => b.getAttribute('aria-pressed'));
const labels = (page) => pills(page).map((b) => b.textContent);

test('every status pill is a button carrying aria-pressed, Archive off by default', () => {
  open(BOARD, (page) => {
    assert.deepStrictEqual(labels(page), ['Todo', 'Done', 'Archive']);
    assert.deepStrictEqual(state(page), ['true', 'true', 'false']);
    for (const b of pills(page)) assert.ok(b.title, 'the tooltip states the grammar');
  });
});

test('a pill leads with a dot in its status colour; off, the dot is the ring and the fill is gone', () => {
  open(BOARD, (page) => {
    const [todo, , archive] = pills(page);
    assert.ok(byClass(todo, 'dot')[0].style.color, 'identity colour on the dot');
    assert.strictEqual(byClass(todo, 'dot')[0].style.background, undefined);
    assert.ok(/\boff\b/.test(archive.className));
  });
});

test('right-click solos a pill, again restores all, and the browser menu is kept away only on a pill', () => {
  withMouse(BOARD, (page) => {
    assert.strictEqual(page.contextmenu(pills(page)[1]), true);
    assert.deepStrictEqual(state(page), ['false', 'true', 'false']);
    assert.strictEqual(page.contextmenu(pills(page)[1]), true);
    assert.deepStrictEqual(state(page), ['true', 'true', 'true']);
    assert.strictEqual(page.contextmenu(page.byId('board')), false);
  });
});

test('a left click still toggles one pill', () => {
  open(BOARD, (page) => {
    page.click(pills(page)[0]);
    assert.deepStrictEqual(state(page), ['false', 'true', 'false']);
  });
});

test('a coarse pointer keeps its own long-press menu on a pill', () => {
  open(BOARD, (page) => {
    assert.strictEqual(page.contextmenu(pills(page)[1]), false);
    assert.deepStrictEqual(state(page), ['true', 'true', 'false']);
  });
});

const opacityUses = (text) => text.match(/style\.opacity|cssText[^\n]*opacity|setProperty\(\s*["']opacity/g) || [];

const VIEWS = ['boardpills', 'mapview', 'ganttview', 'calview'];
const pillIn = (page, view, st) => byClass(page.byId(view), 'pillrow')[0].children.find((b) => b.dataset.st === st);

test('after a toggle, focus returns to the same pill in the view it was pressed in, without scrolling', () => {
  open(BOARD, (page) => {
    for (const view of VIEWS) {
      const pill = pillIn(page, view, 'done');
      pill.focus();
      page.click(pill);
      const active = page.run('document.activeElement');
      assert.ok(active !== pill, `${view}: the pressed pill was rebuilt`);
      assert.ok(active === pillIn(page, view, 'done'), `${view}: focus is on the rebuilt pill of the same view`);
      assert.strictEqual(active.focusOpts && active.focusOpts.preventScroll, true);
      page.click(pillIn(page, view, 'done'));
    }
  });
});

test('after a ContextMenu-key solo, focus returns to the soloed pill of its own view', () => {
  withMouse(BOARD, (page) => {
    const pill = pillIn(page, 'calview', 'todo');
    pill.focus();
    page.contextmenu(pill);
    assert.ok(page.run('document.activeElement') === pillIn(page, 'calview', 'todo'), 'focus is on the soloed pill');
    assert.ok(page.run('document.activeElement').parentNode.parentNode === page.byId('calview'), 'in its own view');
  });
});

test('right-clicking a pill closes an open card menu', () => {
  withMouse(BOARD, (page) => {
    page.run('ctxMenuEl = { remove() { this.removed = true; } }');
    page.contextmenu(pills(page)[0]);
    assert.ok(page.run('ctxMenuEl') === null, 'menu closed');
  });
});

test('the scroll buttons dim by no opacity, and the drag switch reports its state', () => {
  assert.ok(!('opacity' in decls('#scrollbtns button.off')));
  open(BOARD, (page) => {
    assert.ok(['true', 'false'].includes(page.byId('sdrag').getAttribute('aria-pressed')));
  });
});

test('the template dims no live text with opacity, in CSS or through style.opacity', () => {
  const ICON_OR_LINE = /^(\.medge|\.medge\.ghostedge|\.gbar)$|:disabled/;
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])opacity:/.test(m[2])) continue;
    for (const sel of m[1].split(',').map((x) => x.trim())) if (!ICON_OR_LINE.test(sel)) offenders.push(sel);
  }
  assert.deepStrictEqual(offenders, []);
  assert.deepStrictEqual(opacityUses(src), []);
});

test('archived and debug items recede by a dashed edge and muted text', () => {
  for (const sel of ['.card.archcard', '.nrow.nlv-debug', '.cal-cell.out', '.mapiso.arch']) {
    assert.match(decls(sel)['border-style'] || '', /dashed/, sel);
  }
  assert.strictEqual(decls('.nrow.nlv-debug .ntldr').color, 'var(--mut)');
  assert.strictEqual(decls('.nrow.nlv-debug .nmore').color, 'var(--mut)');
  assert.strictEqual(decls('.cal-cell.out .cal-daynum').color, 'var(--mut)');
  assert.strictEqual(decls('.cal-daynum').color, 'var(--ink)');
  assert.strictEqual(decls('.grow.arch .glbl').fill, 'var(--mut)');
  assert.match(decls('.mnode.arch rect')['stroke-dasharray'], /\d/);
});

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}
const DARK_AT = css.indexOf(':root[data-theme="dark"]{');
const THEMES = {
  light: tokens(css.slice(css.indexOf(':root{'), css.indexOf('@media(prefers-color-scheme:dark)'))),
  dark: tokens(css.slice(DARK_AT, css.indexOf('}', DARK_AT))),
};
function lumOf(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratioOf(theme, fg, bg) {
  const a = lumOf(THEMES[theme][fg]), b = lumOf(THEMES[theme][bg]);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const tok = (v) => /var\(--([a-z-]+)\)/.exec(v)[1];

for (const theme of ['light', 'dark']) {
  test(`${theme}: a due chip in an outside calendar cell holds 4.5:1 on its own ground`, () => {
    const chip = decls('.cal-cell.out .cal-chip.duechip');
    const r = ratioOf(theme, tok(decls('.cal-chip.duechip').color), tok(chip.background));
    assert.ok(r >= 4.5, `due chip on the outside cell is ${r.toFixed(2)}:1`);
    const row = decls('.cal-cell.out .cal-rowchip.duechip');
    const r2 = ratioOf(theme, tok(decls('.cal-rowchip.duechip').color), tok(row.background));
    assert.ok(r2 >= 4.5, `due row chip on the outside cell is ${r2.toFixed(2)}:1`);
  });

  test(`${theme}: muted text holds 4.5:1 on the grounds the receded items sit on`, () => {
    for (const g of ['raised', 'surface']) assert.ok(ratioOf(theme, 'mut', g) >= 4.5, `mut on ${g}`);
  });
}

test('the dashed edges that mark a receded item use the stronger line', () => {
  for (const sel of ['.cal-cell.out', '.card.archcard', '.mapiso.arch', '.nrow.nlv-debug']) {
    assert.strictEqual(tok(decls(sel)['border-color']), 'line-strong', sel);
  }
  assert.strictEqual(tok(decls('.mnode.arch rect').stroke), 'line-strong');
});

test('a status containing a double quote does not break a pill toggle', () => {
  open(BOARD, (page) => {
    page.run('COLS.push(\'we"ird\')');
    page.run('render();renderMap();renderGantt();renderCalendar()');
    const pill = pillIn(page, 'mapview', 'we"ird');
    assert.ok(pill, 'the odd status has a pill');
    pill.focus();
    page.click(pill);
    assert.ok(page.run('document.activeElement') === pillIn(page, 'mapview', 'we"ird'), 'focus is on the rebuilt pill');
  });
});

test('the opacity scan catches a cssText assignment and a setProperty call', () => {
  assert.ok(opacityUses('el.style.cssText="color:red;opacity:.5"').length);
  assert.ok(opacityUses("el.style.cssText+=';opacity:.5'").length);
  assert.ok(opacityUses('el.style.setProperty("opacity",".5")').length);
  assert.ok(opacityUses('g.style.opacity=".5"').length);
  assert.deepStrictEqual(opacityUses('el.style.color="red"'), []);
});
