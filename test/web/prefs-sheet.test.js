const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guard = require('../../plugin/skills/web/web/key-guard');

// The gear in the header and the preferences sheet it opens from the right: the
// markup, the markers that keep a selection and hold the poll, and the page
// code that opens, closes, shows and changes each setting. The sheet's drawing
// is the stylesheet's, the settings' storage is prefs.js's (prefs.test.js) and
// the bar mode's is column-state.js's; the real page runs all of it in the
// browser runner's preferences scenario.

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const html = read('app.html');
const css = read('app.css');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const sheetStart = html.indexOf('<div id="prefs-sheet"');
const sheetHtml = sheetStart === -1 ? '' : html.slice(sheetStart, html.indexOf('\n</div>\n', sheetStart) + 7);
const tagsOf = (markup, re) => markup.match(re) || [];
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>])`)); return m ? (m[1] === undefined ? '' : m[1]) : null; };

// --- the gear -------------------------------------------------------------------------

test('the header holds a gear button that names the sheet it opens, is closed to start, and keeps a selection', () => {
  const [gear] = tagsOf(header, /<button[^>]*id="prefs-btn"[^>]*>/);
  assert.ok(gear, 'the gear is in the header');
  assert.strictEqual(attr(gear, 'type'), 'button');
  assert.strictEqual(attr(gear, 'aria-haspopup'), 'dialog');
  assert.strictEqual(attr(gear, 'aria-expanded'), 'false');
  assert.strictEqual(attr(gear, 'aria-label'), 'Preferences');
  assert.strictEqual(attr(gear, 'title'), 'Preferences');
  assert.notStrictEqual(attr(gear, 'data-keeps-selection'), null, 'a click on the gear never clears a selection');
  assert.ok(header.indexOf('id="prefs-btn"') > header.indexOf('id="notif-btn"'), 'it follows the notifications button');
});

test('the gear does not hold the poll: a click leaves focus on it and the board would stop updating', () => {
  const [gear] = tagsOf(header, /<button[^>]*id="prefs-btn"[^>]*>/);
  assert.strictEqual(attr(gear, 'data-holds-poll'), null);
});

test('the gear is an icon button with a drawn gear and no text that a script must fill in', () => {
  const from = header.slice(header.indexOf('id="prefs-btn"'));
  const body = from.slice(0, from.indexOf('</button>'));
  assert.match(body, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.doesNotMatch(body, /\sstyle=/);
});

// --- the sheet ------------------------------------------------------------------------

test('the sheet is a hidden dialog on the modal backdrop, so the poll pauses and the Esc catch-all see it', () => {
  const [root] = tagsOf(sheetHtml, /<div id="prefs-sheet"[^>]*>/);
  assert.match(attr(root, 'class'), /(^|\s)modal-backdrop(\s|$)/);
  assert.match(attr(root, 'class'), /(^|\s)hidden(\s|$)/, 'closed to start');
  assert.notStrictEqual(attr(root, 'data-keeps-selection'), null, 'a click inside it, or on the backdrop that closes it, never clears a selection');
  const [dialog] = tagsOf(sheetHtml, /<aside[^>]*>/);
  assert.strictEqual(attr(dialog, 'role'), 'dialog');
  assert.strictEqual(attr(dialog, 'aria-modal'), 'true');
  assert.strictEqual(attr(dialog, 'aria-labelledby'), 'prefs-title');
  assert.match(sheetHtml, /<h2 id="prefs-title">Preferences<\/h2>/);
});

test('the sheet has a close button, and no tabindex anywhere in it: Tab leaves the sheet from its last control', () => {
  const [close] = tagsOf(sheetHtml, /<button[^>]*id="prefs-close"[^>]*>/);
  assert.ok(close, 'a close button');
  assert.strictEqual(attr(close, 'aria-label'), 'Close preferences');
  assert.doesNotMatch(sheetHtml, /tabindex/i, 'nothing sets a tab order of its own');
});

test('the sheet draws with classes from the stylesheet only: no style attribute, no inline handler', () => {
  assert.doesNotMatch(sheetHtml, /\sstyle=/);
  assert.doesNotMatch(sheetHtml, /\son[a-z]+=/i);
});

test('each of the Board, Map, Gantt and Calendar has an opens and a selects choice, and the Graph shows selects fixed', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    for (const value of ['opens', 'selects']) {
      const tag = tagsOf(sheetHtml, /<button[^>]*class="prefs-opt"[^>]*>/g).find((t) => attr(t, 'data-pref') === 'click' && attr(t, 'data-view') === view && attr(t, 'data-value') === value);
      assert.ok(tag, `${view} ${value}`);
      assert.strictEqual(attr(tag, 'type'), 'button');
      assert.strictEqual(attr(tag, 'disabled'), null, `${view} ${value} can be chosen`);
    }
  }
  const graph = tagsOf(sheetHtml, /<button[^>]*class="prefs-opt"[^>]*>/g).filter((t) => attr(t, 'data-view') === 'graph');
  assert.strictEqual(graph.length, 1, 'one fixed choice');
  assert.strictEqual(attr(graph[0], 'data-value'), 'selects');
  assert.notStrictEqual(attr(graph[0], 'disabled'), null, 'it cannot be changed');
});

test('the roll-up bar has an open and a collapsed choice, and archived leaves a checkbox', () => {
  const opts = tagsOf(sheetHtml, /<button[^>]*class="prefs-opt"[^>]*>/g).filter((t) => attr(t, 'data-pref') === 'bar');
  assert.deepStrictEqual(opts.map((t) => attr(t, 'data-value')), ['open', 'collapsed']);
  const [box] = tagsOf(sheetHtml, /<input[^>]*id="prefs-archived-done"[^>]*>/);
  assert.ok(box);
  assert.strictEqual(attr(box, 'type'), 'checkbox');
  assert.match(sheetHtml, /<input[^>]*id="prefs-archived-done"[^>]*>\s*Count archived leaves as done/);
});

test('every control in the sheet keeps a selection and holds the poll while it has focus', () => {
  const controls = [...tagsOf(sheetHtml, /<button[^>]*>/g), ...tagsOf(sheetHtml, /<input[^>]*>/g)];
  assert.ok(controls.length >= 12, 'sanity: the sheet has its buttons and its checkbox');
  for (const tag of controls) {
    assert.notStrictEqual(attr(tag, 'data-keeps-selection'), null, `keeps the selection: ${tag}`);
    assert.notStrictEqual(attr(tag, 'data-holds-poll'), null, `holds the poll: ${tag}`);
  }
});

test('the sheet is the surface the key guard names, so / and Ctrl+F do nothing while it is open', () => {
  const surface = guard.KEY_GUARD_SURFACES.find((s) => s.name === 'preferences');
  assert.ok(surface, 'the guard names the preferences sheet');
  assert.strictEqual(surface.selector, '#prefs-sheet:not(.hidden)');
  const id = surface.selector.match(/^#([\w-]+)/)[1];
  assert.ok(html.includes(`id="${id}"`), 'the page has an element by that id');
  assert.match(sheetHtml, new RegExp(`id="${id}"[^>]*class="[^"]*\\bhidden\\b`), 'and it is hidden until the gear opens it');
});

test('the sheet sits after the page\'s other popups and before the scripts', () => {
  assert.ok(html.indexOf('id="prefs-sheet"') > html.indexOf('id="notif-modal"'));
  assert.ok(html.indexOf('id="prefs-sheet"') < html.indexOf('<script src="/refresh-policy.js">'));
});

test('the sheet\'s settings are not written to the board: nothing in the sheet code calls the server', () => {
  for (const name of ['openPrefsSheet', 'closePrefsSheet', 'syncPrefsSheet', 'onPrefsSheetClick', 'setClickPref', 'setArchivedDone', 'setPillsFolded', 'setSlicesFolded', 'setPanelOnFocus', 'setRollupBarMode']) {
    assert.doesNotMatch(fn(name), /\bapi\(|fetch\(|XMLHttpRequest/, name);
  }
});

test('the sheet code writes no style: no style attribute, no inline style property', () => {
  for (const name of ['openPrefsSheet', 'closePrefsSheet', 'syncPrefsSheet', 'onPrefsSheetClick']) {
    assert.doesNotMatch(fn(name), /style=|\.style\b|setAttribute\('style'/, name);
  }
});

// --- opening, closing and showing the settings --------------------------------------------

function fakeEl(id, classes = []) {
  const set = new Set(classes);
  const attrs = {};
  return {
    id, attrs, dataset: {}, checked: false, disabled: false,
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); } },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    focus() { this.owner.focused = this; },
  };
}

// A page with the sheet's elements, a store for the choices and the pieces of
// app.js the sheet's code calls, so each function runs as the page defines it.
function sheetPage({ stored = {}, detailOpen = false } = {}) {
  const colState = require('../../plugin/skills/web/web/column-state');
  const writes = {};
  const log = { colour: [], renders: 0, details: [], folds: [], statusFolds: [], sliceFolds: [], typingFolds: [], hoverFolds: [], switches: [], focused: null, shown: [], went: [] };
  const sheet = fakeEl('prefs-sheet', ['modal-backdrop', 'hidden']);
  const gear = fakeEl('prefs-btn');
  gear.setAttribute('aria-expanded', 'false');
  const close = fakeEl('prefs-close');
  const archived = fakeEl('prefs-archived-done');
  const pillsFolded = fakeEl('prefs-pills-folded');
  const statusesFolded = fakeEl('prefs-statuses-folded');
  const slicesFolded = fakeEl('prefs-slices-folded');
  const typingFolded = fakeEl('prefs-typing-folded');
  const hoverFolded = fakeEl('prefs-hover-folded');
  const panelOnFocus = fakeEl('prefs-panel-on-focus');
  const mdColour = fakeEl('prefs-md-colour');
  const opts = [];
  const opt = (pref, value, extra = {}) => {
    const o = fakeEl(`${pref}-${value}`);
    Object.assign(o.dataset, { pref, value, ...extra });
    o.setAttribute('aria-pressed', 'false');
    opts.push(o);
    return o;
  };
  for (const view of ['board', 'map', 'gantt', 'calendar']) for (const value of ['opens', 'selects']) opt('click', value, { view });
  const graph = opt('click', 'selects', { view: 'graph' });
  graph.disabled = true;
  for (const value of ['open', 'collapsed']) opt('bar', value);
  sheet.querySelectorAll = (sel) => { assert.strictEqual(sel, '.prefs-opt'); return opts; };
  const more = fakeEl('more-btn');
  const owner = log;
  for (const e of [sheet, gear, more, close, archived, pillsFolded, statusesFolded, slicesFolded, typingFolded, hoverFolded, panelOnFocus, mdColour, ...opts]) e.owner = owner;
  const byId = { '#prefs-sheet': sheet, '#prefs-btn': gear, '#more-btn': more, '#prefs-close': close, '#prefs-archived-done': archived, '#prefs-pills-folded': pillsFolded, '#prefs-statuses-folded': statusesFolded, '#prefs-slices-folded': slicesFolded, '#prefs-typing-folded': typingFolded, '#prefs-hover-folded': hoverFolded, '#prefs-panel-on-focus': panelOnFocus, '#prefs-md-colour': mdColour };
  const sandbox = {
    state: { projectName: 'shop' },
    ...colState,
    ...require('../../plugin/skills/web/web/prefs'),
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null),
      setItem: (k, v) => { writes[k] = v; stored[k] = v; },
    },
    $: (sel) => { assert.ok(byId[sel], `the page looks up ${sel}`); return byId[sel]; },
    renderBoard: () => { log.renders++; },
    renderDetailRollup: (id) => { log.details.push(id); },
    foldSearchPills: (folded) => { log.folds.push(folded); },
    foldSearchSlices: (folded) => { log.sliceFolds.push(folded); },
    foldSearchStatuses: (folded) => { log.statusFolds.push(folded); },
    foldSearchTyping: (folded) => { log.typingFolds.push(folded); },
    foldSearchHover: (folded) => { log.hoverFolds.push(folded); },
    applySearchPanelSwitch: (on, openNow) => { log.switches.push([on, openNow]); },
    mdEditSetOn: (on) => { log.colour.push(on); },
    settingsShow: (page) => { log.shown.push(page); },
    settingsGo: (page) => { log.went.push(page); },
    currentDetailId: detailOpen ? 4 : null,
    sheet, gear, more, close, archived, pillsFolded, statusesFolded, slicesFolded, typingFolded, hoverFolded, panelOnFocus, mdColour, opts, writes, log,
  };
  vm.createContext(sandbox);
  const memo = (re, what) => { const m = appSrc.match(re); assert.ok(m, what); return m[0]; };
  vm.runInContext([
    memo(/^let rollupBarMode = null;$/m, 'bar memo'), memo(/^let prefsMemo = null;$/m, 'prefs memo'),
    fn('loadRollupBarMode'), fn('saveRollupBarMode'), fn('prefsStorage'), fn('loadPrefsState'), fn('savePrefsState'), fn('countArchivedLeaves'),
    fn('repaintRollups'), fn('setRollupBarMode'), fn('toggleRollupBar'), fn('setClickPref'), fn('setArchivedDone'), fn('setFoldPref'), fn('setPillsFolded'), fn('setStatusesFolded'), fn('setSlicesFolded'), fn('setTypingFolded'), fn('setHoverFolded'), fn('setPanelOnFocus'), fn('setMdColour'),
    fn('prefOptionOn'), fn('syncPrefsSheet'), fn('openPrefsSheet'), fn('closePrefsSheet'), fn('onPrefsSheetClick'),
  ].join('\n'), sandbox);
  return sandbox;
}

const optOf = (p, pref, value, view) => p.opts.find((o) => o.dataset.pref === pref && o.dataset.value === value && (view === undefined || o.dataset.view === view));
const pressed = (p) => p.opts.filter((o) => o.attrs['aria-pressed'] === 'true').map((o) => (o.dataset.view ? `${o.dataset.view}:${o.dataset.value}` : `bar:${o.dataset.value}`)).sort();

test('opening the sheet shows it, marks the gear expanded and puts focus on the close button', () => {
  const p = sheetPage();
  p.openPrefsSheet();
  assert.strictEqual(p.sheet.classList.contains('hidden'), false);
  assert.strictEqual(p.gear.attrs['aria-expanded'], 'true');
  assert.strictEqual(p.log.focused, p.close);
});

test('closing the sheet hides it, marks the gear collapsed and returns focus to the gear', () => {
  const p = sheetPage();
  p.openPrefsSheet();
  p.closePrefsSheet();
  assert.strictEqual(p.sheet.classList.contains('hidden'), true);
  assert.strictEqual(p.gear.attrs['aria-expanded'], 'false');
  assert.strictEqual(p.log.focused, p.gear);
});

test('closing the sheet on a phone, where the gear is hidden, returns focus to the More button', () => {
  const p = sheetPage();
  p.gear.offsetParent = null;
  p.openPrefsSheet();
  p.closePrefsSheet();
  assert.strictEqual(p.log.focused, p.more);
});

test('with nothing stored the sheet shows the defaults: every view opens, the Graph selects, the bar is collapsed, archived leaves count', () => {
  const p = sheetPage();
  p.openPrefsSheet();
  assert.deepStrictEqual(pressed(p), ['bar:collapsed', 'board:opens', 'calendar:opens', 'gantt:opens', 'graph:selects', 'map:opens']);
  assert.strictEqual(p.archived.checked, true);
});

test('the sheet shows what the browser kept for this board', () => {
  const p = sheetPage({ stored: {
    'kanban.shop.prefs': JSON.stringify({ click: { board: 'selects', gantt: 'selects' }, archivedDone: false }),
    'kanban.shop.rollup.bar': 'open',
  } });
  p.openPrefsSheet();
  assert.deepStrictEqual(pressed(p), ['bar:open', 'board:selects', 'calendar:opens', 'gantt:selects', 'graph:selects', 'map:opens']);
  assert.strictEqual(p.archived.checked, false);
});

test('a browser that still holds rollup.archived set to false counts archived leaves as done, and the sheet shows the toggle on', () => {
  for (const old of ['false', 'true']) {
    const p = sheetPage({ stored: { 'kanban.shop.rollup.archived': old } });
    p.openPrefsSheet();
    assert.strictEqual(p.archived.checked, true, old);
    assert.strictEqual(p.countArchivedLeaves(), true, old);
  }
});

test('choosing selects for a view saves it under the board\'s prefs entry, shows it, and changes no other view', () => {
  const p = sheetPage();
  p.openPrefsSheet();
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'click', 'selects', 'map') } });
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
  assert.deepStrictEqual(JSON.parse(p.writes['kanban.shop.prefs']).click, { board: 'opens', map: 'selects', gantt: 'opens', calendar: 'opens', graph: 'selects' });
  assert.deepStrictEqual(pressed(p), ['bar:collapsed', 'board:opens', 'calendar:opens', 'gantt:opens', 'graph:selects', 'map:selects']);
  assert.strictEqual(p.log.renders, 0, 'nothing on the board changes with this one');
});

test('a choice is kept per board: another board\'s name reads its own entry', () => {
  const p = sheetPage();
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'click', 'selects', 'board') } });
  vm.runInContext("state.projectName = 'lab'; prefsMemo = null;", p);
  assert.strictEqual(p.loadPrefsState().click.board, 'opens');
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
});

test('the sheet shows the pill section as starting unfolded, and as folded when the browser kept that for this board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.pillsFolded.checked, false);
  const kept = sheetPage({ stored: { 'kanban.shop.prefs': JSON.stringify({ pillsFolded: true }) } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.pillsFolded.checked, true);
});

test('choosing that the pill section starts folded saves it in the prefs entry, folds the section now, and repaints nothing', () => {
  const p = sheetPage();
  p.setPillsFolded(true);
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).pillsFolded, true);
  assert.deepStrictEqual(p.log.folds, [true]);
  assert.strictEqual(p.log.renders, 0);
  p.setPillsFolded(false);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).pillsFolded, false);
  assert.deepStrictEqual(p.log.folds, [true, false]);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).archivedDone, true, 'the other settings are left alone');
});

test('the sheet shows the Statuses section as starting open, and as folded when the browser kept that for this board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.statusesFolded.checked, false, 'open by default');
  const kept = sheetPage({ stored: { 'kanban.shop.prefs': JSON.stringify({ statusesFolded: true }) } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.statusesFolded.checked, true);
});

test('choosing that the Statuses section starts folded saves it in the prefs entry, folds the section now, and repaints nothing', () => {
  const p = sheetPage();
  p.setStatusesFolded(true);
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).statusesFolded, true);
  assert.deepStrictEqual(p.log.statusFolds, [true]);
  assert.strictEqual(p.log.renders, 0);
  p.setStatusesFolded(false);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).statusesFolded, false);
  assert.deepStrictEqual(p.log.statusFolds, [true, false]);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).pillsFolded, false, 'the other settings are left alone');
  assert.deepStrictEqual(p.log.folds, [], 'and the pill section is not folded or unfolded by it');
});

test('the sheet shows the slice section as starting folded, and as unfolded when the browser kept that for this board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.slicesFolded.checked, true, 'folded by default');
  const kept = sheetPage({ stored: { 'kanban.shop.prefs': JSON.stringify({ slicesFolded: false }) } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.slicesFolded.checked, false);
});

test('choosing that the slice section starts unfolded saves it in the prefs entry, unfolds the section now, and repaints nothing', () => {
  const p = sheetPage();
  p.setSlicesFolded(false);
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).slicesFolded, false);
  assert.deepStrictEqual(p.log.sliceFolds, [false]);
  assert.strictEqual(p.log.renders, 0);
  p.setSlicesFolded(true);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).slicesFolded, true);
  assert.deepStrictEqual(p.log.sliceFolds, [false, true]);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).pillsFolded, false, 'the other settings are left alone');
  assert.deepStrictEqual(p.log.folds, [], 'and the pill section is not folded or unfolded by it');
});

test('the sheet shows the panel as opening on focus to start, and as not when the browser kept that for this board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.panelOnFocus.checked, true);
  const kept = sheetPage({ stored: { 'kanban.shop.prefs': JSON.stringify({ panelOnFocus: false }) } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.panelOnFocus.checked, false);
  const other = sheetPage({ stored: { 'kanban.lab.prefs': JSON.stringify({ panelOnFocus: false }) } });
  other.openPrefsSheet();
  assert.strictEqual(other.panelOnFocus.checked, true, 'another board\'s choice is not this board\'s');
});

test('the sheet shows the choice the arrow or the p key made, which is the same stored switch', () => {
  const p = sheetPage();
  p.setPanelOnFocus(false, true);
  p.openPrefsSheet();
  assert.strictEqual(p.panelOnFocus.checked, false);
  p.setPanelOnFocus(true, true);
  p.openPrefsSheet();
  assert.strictEqual(p.panelOnFocus.checked, true);
});

test('choosing that the panel opens on focus saves it in the prefs entry and tells the panel without opening it, and repaints nothing', () => {
  const p = sheetPage();
  p.setPanelOnFocus(false);
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.prefs']);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).panelOnFocus, false);
  assert.deepStrictEqual(p.log.switches, [[false, false]]);
  p.setPanelOnFocus(true);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).panelOnFocus, true);
  assert.deepStrictEqual(p.log.switches, [[false, false], [true, false]], 'on opens nothing from the sheet, which is up over the board');
  assert.strictEqual(p.log.renders, 0);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).pillsFolded, false, 'the other settings are left alone');
});

test('the arrow and the p key tell the panel to open at once when they turn the switch on', () => {
  const p = sheetPage();
  p.setPanelOnFocus(false, true);
  p.setPanelOnFocus(true, true);
  assert.deepStrictEqual(p.log.switches, [[false, true], [true, true]]);
});

test('the fixed Graph choice cannot be changed from the sheet', () => {
  const p = sheetPage();
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'click', 'selects', 'graph') } });
  assert.deepStrictEqual(p.writes, {});
});

test('choosing a roll-up bar mode writes the same key a click on a bar writes, and repaints the board and the open detail', () => {
  const p = sheetPage({ detailOpen: true });
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'bar', 'open') } });
  assert.deepStrictEqual(p.writes, { 'kanban.shop.rollup.bar': 'open' });
  assert.strictEqual(p.log.renders, 1);
  assert.deepStrictEqual(p.log.details, [4]);
  assert.strictEqual(optOf(p, 'bar', 'open').attrs['aria-pressed'], 'true');
  assert.strictEqual(optOf(p, 'bar', 'collapsed').attrs['aria-pressed'], 'false');
});

test('a click on a bar and the sheet always agree, since both set the one stored mode', () => {
  const p = sheetPage();
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'bar', 'open') } });
  p.toggleRollupBar();
  assert.strictEqual(p.writes['kanban.shop.rollup.bar'], 'collapsed');
  p.openPrefsSheet();
  assert.strictEqual(optOf(p, 'bar', 'collapsed').attrs['aria-pressed'], 'true', 'the sheet shows what the bar click set');
  p.toggleRollupBar();
  p.openPrefsSheet();
  assert.strictEqual(optOf(p, 'bar', 'open').attrs['aria-pressed'], 'true');
});

test('the sheet\'s bar mode and a bar click write only the existing key: there is no second stored choice', () => {
  const p = sheetPage();
  p.onPrefsSheetClick({ target: { id: 'x', closest: () => optOf(p, 'bar', 'open') } });
  p.toggleRollupBar();
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.shop.rollup.bar']);
  assert.doesNotMatch(JSON.stringify(p.loadPrefsState()), /bar|collapsed/);
});

test('switching archived leaves off saves it in the prefs entry, leaves the old key alone, and repaints every roll-up', () => {
  const p = sheetPage({ detailOpen: true, stored: { 'kanban.shop.rollup.archived': 'true' } });
  p.setArchivedDone(false);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).archivedDone, false);
  assert.strictEqual(p.writes['kanban.shop.rollup.archived'], undefined);
  assert.strictEqual(p.countArchivedLeaves(), false);
  assert.strictEqual(p.log.renders, 1);
  assert.deepStrictEqual(p.log.details, [4]);
  p.setArchivedDone(true);
  assert.strictEqual(p.countArchivedLeaves(), true);
  assert.strictEqual(p.log.renders, 2);
});

test('a click on the backdrop itself closes the sheet; a click inside it does not', () => {
  const p = sheetPage();
  p.openPrefsSheet();
  p.onPrefsSheetClick({ target: { id: 'prefs-sheet', closest: () => null } });
  assert.strictEqual(p.sheet.classList.contains('hidden'), true);
  p.openPrefsSheet();
  p.onPrefsSheetClick({ target: { id: 'prefs-title', closest: () => null } });
  assert.strictEqual(p.sheet.classList.contains('hidden'), false);
});

test('the sheet shows the Typing isolates and On hover show sections as starting folded, and as unfolded when the browser kept that for this board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.typingFolded.checked, true, 'folded by default');
  assert.strictEqual(none.hoverFolded.checked, true, 'folded by default');
  const kept = sheetPage({ stored: { 'kanban.shop.prefs': JSON.stringify({ typingFolded: false, hoverFolded: false }) } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.typingFolded.checked, false);
  assert.strictEqual(kept.hoverFolded.checked, false);
});

test('choosing that the Typing isolates or the On hover show section starts unfolded saves it in the prefs entry and takes the section now, each alone', () => {
  const p = sheetPage();
  p.setTypingFolded(false);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).typingFolded, false);
  assert.deepStrictEqual(p.log.typingFolds, [false]);
  assert.deepStrictEqual(p.log.hoverFolds, [], 'the other section is left alone');
  p.setHoverFolded(false);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).hoverFolded, false);
  assert.deepStrictEqual(p.log.hoverFolds, [false]);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).typingFolded, false, 'the first choice stays');
  p.setTypingFolded(true);
  p.setHoverFolded(true);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).typingFolded, true);
  assert.strictEqual(JSON.parse(p.writes['kanban.shop.prefs']).hoverFolded, true);
  assert.strictEqual(p.log.renders, 0);
  assert.deepStrictEqual(p.log.folds, []);
});

test('the checkbox, the close button and the gear are wired in the DOMContentLoaded block', () => {
  assert.match(appSrc, /\$\('#prefs-btn'\)\.addEventListener\('click', \(\) => openPrefsSheet\(\)\);/);
  assert.match(appSrc, /\$\('#prefs-close'\)\.addEventListener\('click', closePrefsSheet\);/);
  assert.match(appSrc, /\$\('#prefs-sheet'\)\.addEventListener\('click', onPrefsSheetClick\);/);
  assert.match(appSrc, /\$\('#prefs-archived-done'\)\.addEventListener\('change', \(e\) => setArchivedDone\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-pills-folded'\)\.addEventListener\('change', \(e\) => setPillsFolded\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-statuses-folded'\)\.addEventListener\('change', \(e\) => setStatusesFolded\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-slices-folded'\)\.addEventListener\('change', \(e\) => setSlicesFolded\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-typing-folded'\)\.addEventListener\('change', \(e\) => setTypingFolded\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-hover-folded'\)\.addEventListener\('change', \(e\) => setHoverFolded\(e\.target\.checked\)\);/);
  assert.match(appSrc, /\$\('#prefs-panel-on-focus'\)\.addEventListener\('change', \(e\) => setPanelOnFocus\(e\.target\.checked\)\);/);
});

test('the panel-on-focus choice is a checkbox beside the pill-section one, in the Search panel group, and says what it is', () => {
  const [box] = tagsOf(sheetHtml, /<input[^>]*id="prefs-panel-on-focus"[^>]*>/);
  assert.ok(box);
  assert.strictEqual(attr(box, 'type'), 'checkbox');
  assert.notStrictEqual(attr(box, 'data-keeps-selection'), null, 'a click on it never clears a selection');
  assert.notStrictEqual(attr(box, 'data-holds-poll'), null, 'the poll waits while the sheet is up, as for the other checkboxes');
  assert.match(sheetHtml, /<input[^>]*id="prefs-panel-on-focus"[^>]*>\s*Panel opens when the search box is focused/);
  const group = sheetHtml.slice(sheetHtml.indexOf('id="prefs-panel-title"'));
  assert.ok(group.includes('id="prefs-pills-folded"') && group.includes('id="prefs-panel-on-focus"'), 'both are in the Search panel group');
  assert.match(group, /arrow[^<]*\bp\b key|p key[^<]*arrow/, 'the group says the arrow and the p key are the same switch');
});

test('the slice-section choice is a checkbox beside the pill-section one, in the Search panel group, and says what it is', () => {
  const [box] = tagsOf(sheetHtml, /<input[^>]*id="prefs-slices-folded"[^>]*>/);
  assert.ok(box);
  assert.strictEqual(attr(box, 'type'), 'checkbox');
  assert.notStrictEqual(attr(box, 'data-keeps-selection'), null, 'a click on it never clears a selection');
  assert.notStrictEqual(attr(box, 'data-holds-poll'), null, 'the poll waits while the sheet is up, as for the other checkboxes');
  assert.match(sheetHtml, /<input[^>]*id="prefs-slices-folded"[^>]*>\s*Slice section starts folded/);
  const group = sheetHtml.slice(sheetHtml.indexOf('id="prefs-panel-title"'));
  assert.ok(group.indexOf('id="prefs-slices-folded"') > -1 && group.indexOf('id="prefs-slices-folded"') < group.indexOf('id="prefs-pills-folded"'), 'the slices come first in the group, as in the panel');
});

test('the Statuses-section choice is a checkbox right after the pill-section one, in the Search panel group, and says what it is', () => {
  const [box] = tagsOf(sheetHtml, /<input[^>]*id="prefs-statuses-folded"[^>]*>/);
  assert.ok(box);
  assert.strictEqual(attr(box, 'type'), 'checkbox');
  assert.notStrictEqual(attr(box, 'data-keeps-selection'), null, 'a click on it never clears a selection');
  assert.notStrictEqual(attr(box, 'data-holds-poll'), null, 'the poll waits while the sheet is up, as for the other checkboxes');
  assert.match(sheetHtml, /<input[^>]*id="prefs-statuses-folded"[^>]*>\s*Status section starts folded/);
  const group = sheetHtml.slice(sheetHtml.indexOf('id="prefs-panel-title"'));
  const at = (id) => group.indexOf(`id="${id}"`);
  assert.ok(at('prefs-pills-folded') > -1 && at('prefs-statuses-folded') > at('prefs-pills-folded'), 'it comes after the pill one');
  assert.ok(at('prefs-statuses-folded') < at('prefs-panel-on-focus'), 'and before the switch');
});

test('the pill-section choice is a checkbox in its own group of the sheet, and says what it is', () => {
  const [box] = tagsOf(sheetHtml, /<input[^>]*id="prefs-pills-folded"[^>]*>/);
  assert.ok(box);
  assert.strictEqual(attr(box, 'type'), 'checkbox');
  assert.match(sheetHtml, /<input[^>]*id="prefs-pills-folded"[^>]*>\s*Pill section starts folded/);
});

// --- Esc, the poll, the key guard ------------------------------------------------------------

function escHandler() {
  const m = appSrc.match(/document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key !== 'Escape'\) return;[\s\S]*?\n\s*\}\);/);
  assert.ok(m, 'the document-level Escape handler is found');
  return m[0];
}

function escPage({ open = [] } = {}) {
  const calls = [];
  const prevented = [];
  const listeners = [];
  const els = {};
  for (const id of ['#context-menu', '#notif-modal', '#detail-modal', '#modal', '#prefs-sheet']) {
    els[id] = fakeEl(id, open.includes(id) ? [] : ['hidden']);
  }
  const sandbox = {
    document: { addEventListener: (type, f) => listeners.push([type, f]) },
    $: (sel) => els[sel],
    hideContextMenu: () => calls.push('menu'), closeNotifModal: () => calls.push('notifications'), closeCard: () => calls.push('card'),
    requestCloseModal: () => calls.push('edit'), closeAnyBulkPopup: () => false, anyModalOpen: () => open.some((id) => id !== '#search-panel'),
    closeSearchPanel: () => (open.includes('#search-panel') ? (calls.push('panel'), true) : false),
    escapeStep: () => calls.push('step'), settingsStepBack: () => calls.push('prefs'), moreMenuClose: () => false,
  };
  vm.createContext(sandbox);
  vm.runInContext(escHandler(), sandbox);
  assert.strictEqual(listeners.length, 1);
  return { esc: (extra = {}) => listeners[0][1]({ key: 'Escape', preventDefault: () => prevented.push(true), ...extra }), calls, prevented };
}

test('Esc closes the open preferences sheet, and nothing else', () => {
  const p = escPage({ open: ['#prefs-sheet'] });
  p.esc();
  assert.deepStrictEqual(p.calls, ['prefs']);
});

test('an open search panel takes Esc after the popups and before the end of the chain: it closes, and nothing else runs', () => {
  const p = escPage({ open: ['#search-panel'] });
  p.esc();
  assert.deepStrictEqual(p.calls, ['panel']);
  assert.strictEqual(p.prevented.length, 1, 'the panel\'s Esc stops the browser\'s own, which would clear a search field');
  const withMenu = escPage({ open: ['#context-menu', '#search-panel'] });
  withMenu.esc();
  assert.deepStrictEqual(withMenu.calls, ['menu'], 'a popup that is open takes it first');
});

test('with the sheet closed, Esc does what it did: the menu, then the dialogs, then the end of the chain', () => {
  const none = escPage();
  none.esc();
  assert.deepStrictEqual(none.calls, ['step']);
  const menu = escPage({ open: ['#context-menu'] });
  menu.esc();
  assert.deepStrictEqual(menu.calls, ['menu']);
  const card = escPage({ open: ['#detail-modal'] });
  card.esc();
  assert.deepStrictEqual(card.calls, ['card']);
});

test('a held Esc runs the end of the chain once: a repeated keydown with nothing open does nothing', () => {
  const p = escPage();
  p.esc();
  p.esc({ repeat: true });
  p.esc({ repeat: true });
  assert.deepStrictEqual(p.calls, ['step']);
  p.esc();
  assert.deepStrictEqual(p.calls, ['step', 'step'], 'a fresh press steps again');
});

test('the sheet\'s line is added to the Esc handler without moving the lines around it', () => {
  const body = escHandler();
  const at = (s) => body.indexOf(s);
  assert.ok(at("settingsStepBack(); return;") > at("closeNotifModal(); return;"));
  assert.ok(at("settingsStepBack(); return;") < at("closeCard(); return;"));
  assert.ok(at("if (anyModalOpen()) return;") > at("settingsStepBack(); return;"), 'the catch-all stays last but for the end of the chain');
});

test('an open sheet stops the 5s poll, because it sits on the modal backdrop the poll already reads', () => {
  const sandbox = { document: { querySelector: (sel) => (sel === '.modal-backdrop:not(.hidden)' ? { id: 'prefs-sheet' } : null) } };
  vm.createContext(sandbox);
  vm.runInContext(fn('anyModalOpen'), sandbox);
  assert.strictEqual(sandbox.anyModalOpen(), true);
  const { shouldSkipAutoRefresh } = require('../../plugin/skills/web/web/refresh-policy');
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: sandbox.anyModalOpen(), dragging: false, hidden: false, boardControlFocused: false }), true);
});

test('a click on the gear or inside the sheet leaves a selection as it was', () => {
  const { KEEPS } = require('./helpers/markers');
  const [gear] = tagsOf(header, /<button[^>]*id="prefs-btn"[^>]*>/);
  const [root] = tagsOf(sheetHtml, /<div id="prefs-sheet"[^>]*>/);
  assert.ok(gear.includes(KEEPS) && root.includes(KEEPS));
  const sandbox = { setSelection() { throw new Error('the selection was cleared'); }, renderBoard() { throw new Error('the board repainted'); }, selectedIds: new Set([1, 2]) };
  vm.createContext(sandbox);
  vm.runInContext(fn('onClickAway'), sandbox);
  for (const marked of [gear, root]) {
    sandbox.onClickAway({ shiftKey: false, ctrlKey: false, metaKey: false, detail: 2, target: { closest: (sel) => (sel === `[${KEEPS}]` ? marked : null) } });
  }
});

test('the preferences module is a page script loaded before the selection module that the click rule lives in', () => {
  const at = (s) => html.indexOf(`<script src="/${s}"></script>`);
  assert.ok(at('prefs.js') > -1, 'loaded by the page');
  assert.ok(at('prefs.js') > at('column-state.js'), 'after the module that gives it the storage key');
  assert.ok(at('prefs.js') < at('app.js'));
});

test('the sheet\'s rules are in the stylesheet: a slide in from the right, a full-height column, and no colour of its own', () => {
  assert.match(css, /\.prefs-backdrop \{[^}]*justify-content: flex-end/);
  assert.match(css, /\.prefs-sheet \{[^}]*height: 100(vh|%)/);
  assert.match(css, /@keyframes prefs-slide/);
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.prefs-sheet \{ animation: none; \}/);
  const block = css.slice(css.indexOf('/* Preferences sheet'), css.indexOf('/* End preferences sheet'));
  assert.ok(block.length > 200, 'the sheet\'s rules sit in one marked block');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'colours come from the tokens');
  for (const cls of ['prefs-btn', 'prefs-backdrop', 'prefs-sheet', 'prefs-head', 'prefs-group', 'prefs-row', 'prefs-seg', 'prefs-opt', 'prefs-check', 'prefs-hint']) {
    assert.match(block, new RegExp(`\\.${cls}\\b`), `${cls} has a rule`);
  }
});

test('the sheet shows the Markdown boxes as coloured to start, and as not when this browser kept that, on every board', () => {
  const none = sheetPage();
  none.openPrefsSheet();
  assert.strictEqual(none.mdColour.checked, true);
  const kept = sheetPage({ stored: { 'kanban.md-colour': 'false' } });
  kept.openPrefsSheet();
  assert.strictEqual(kept.mdColour.checked, false);
  const other = sheetPage({ stored: { 'kanban.md-colour': 'false' } });
  other.state.projectName = 'lab';
  other.openPrefsSheet();
  assert.strictEqual(other.mdColour.checked, false, "the choice is the browser's, not a board's");
});

test('choosing to colour or not saves one browser-wide key and tells the boxes, leaving the prefs entry of a board and the board alone', () => {
  const p = sheetPage();
  p.setMdColour(false);
  assert.deepStrictEqual(Object.keys(p.writes), ['kanban.md-colour']);
  assert.strictEqual(p.writes['kanban.md-colour'], 'false');
  assert.deepStrictEqual(p.log.colour, [false]);
  p.setMdColour(true);
  assert.strictEqual(p.writes['kanban.md-colour'], 'true');
  assert.deepStrictEqual(p.log.colour, [false, true]);
  assert.strictEqual(p.log.renders, 0, 'nothing on the board is repainted');
});

test('the Typing isolates and On hover show choices are checkboxes after the Status one, in the Search panel group, and say what they are', () => {
  const group = sheetHtml.slice(sheetHtml.indexOf('id="prefs-panel-title"'));
  const at = (id) => group.indexOf(`id="${id}"`);
  for (const [id, text] of [['prefs-typing-folded', 'Typing isolates section starts folded'], ['prefs-hover-folded', 'On hover show section starts folded']]) {
    const [box] = tagsOf(sheetHtml, new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(box, id);
    assert.strictEqual(attr(box, 'type'), 'checkbox');
    assert.notStrictEqual(attr(box, 'data-keeps-selection'), null);
    assert.notStrictEqual(attr(box, 'data-holds-poll'), null);
    assert.match(sheetHtml, new RegExp(`<input[^>]*id="${id}"[^>]*> *${text}`));
  }
  assert.ok(at('prefs-statuses-folded') < at('prefs-typing-folded') && at('prefs-typing-folded') < at('prefs-hover-folded') && at('prefs-hover-folded') < at('prefs-panel-on-focus'), 'in the panel\'s order, before the switch');
});
