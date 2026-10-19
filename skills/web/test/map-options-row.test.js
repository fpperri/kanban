const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const cssSrc = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function rowSandbox() {
  const { escapeHtml } = require('../web/assignee-badge');
  const { MAP_OPTION_VALUES, MAP_OPTION_DEFAULTS } = require('../web/map-relations');
  const labels = appSrc.match(/const MAP_OPTION_LABELS = \{[\s\S]*?\n\};/);
  assert.ok(labels, 'MAP_OPTION_LABELS found in app.js');
  const sandbox = { escapeHtml, MAP_OPTION_VALUES, MAP_OPTION_DEFAULTS };
  vm.createContext(sandbox);
  vm.runInContext([labels[0], fn('mapOptionsRowHtml')].join('\n'), sandbox);
  return sandbox;
}

const groupsOf = (html) => [...html.matchAll(/<span class="map-option" title="([^"]*)"><span class="map-option-label">([^<]*)<\/span>([\s\S]*?)<\/span><\/span>/g)]
  .map((m) => ({ hint: m[1], label: m[2], buttons: [...m[3].matchAll(/<button type="button" class="map-option-btn( active)?" data-key="(\w+)" data-val="(\w+)" aria-pressed="(true|false)"( data-keeps-selection data-holds-poll)?>([^<]*)<\/button>/g)]
    .map((b) => ({ active: !!b[1], key: b[2], val: b[3], pressed: b[4] === 'true', marked: !!b[5], text: b[6] })) }));

test('the row has one control per option, labelled as the docs name them', () => {
  const w = rowSandbox();
  const groups = groupsOf(w.mapOptionsRowHtml(w.MAP_OPTION_DEFAULTS));
  assert.deepStrictEqual(groups.map((g) => g.label), [
    'Parent lines', 'Dependency lines', 'Graphs', 'Parent sits', 'Align', 'Row order', 'Layout', 'Cards',
  ]);
});

test('each control offers every value the options allow, default first, in words', () => {
  const w = rowSandbox();
  const groups = groupsOf(w.mapOptionsRowHtml(w.MAP_OPTION_DEFAULTS));
  assert.deepStrictEqual(groups.map((g) => g.buttons.map((b) => b.text)), [
    ['chain ends', 'all', 'off'], ['on', 'off'], ['one per tree', 'one graph'], ['below', 'above'],
    ['center', 'left'], ['by status', 'layout'], ['keep', 'reflow'], ['rich', 'plain'],
  ]);
  for (const g of groups) {
    assert.deepStrictEqual(g.buttons.map((b) => b.val), [...w.MAP_OPTION_VALUES[g.buttons[0].key]]);
    assert.ok(g.buttons.every((b) => b.key === g.buttons[0].key));
  }
});

test('exactly one button of each control is pressed, the one the options hold', () => {
  const w = rowSandbox();
  const chosen = { ...w.MAP_OPTION_DEFAULTS, parent: 'above', cards: 'plain' };
  for (const g of groupsOf(w.mapOptionsRowHtml(chosen))) {
    const pressed = g.buttons.filter((b) => b.pressed);
    assert.strictEqual(pressed.length, 1, g.label);
    assert.strictEqual(pressed[0].val, chosen[pressed[0].key], g.label);
    assert.deepStrictEqual(g.buttons.filter((b) => b.active), pressed, 'the active class follows aria-pressed');
  }
});

test('every control explains itself in a tooltip', () => {
  const w = rowSandbox();
  for (const g of groupsOf(w.mapOptionsRowHtml(w.MAP_OPTION_DEFAULTS))) {
    assert.ok(g.hint.length > 20, `${g.label} has a tooltip`);
  }
});

test('the row writes no style attribute, which the strict CSP would block', () => {
  const w = rowSandbox();
  assert.doesNotMatch(w.mapOptionsRowHtml(w.MAP_OPTION_DEFAULTS), /\sstyle=/);
});

test('every option the options module offers has a label here, so the row cannot lose one', () => {
  const w = rowSandbox();
  const html = w.mapOptionsRowHtml(w.MAP_OPTION_DEFAULTS);
  const total = Object.values(w.MAP_OPTION_VALUES).reduce((n, values) => n + values.length, 0);
  assert.strictEqual((html.match(/<button /g) || []).length, total);
});

// --- where the row sits and what it triggers -------------------------------------

test('the options row sits in the option panel, below the zoom controls, and the status pills stay in the view', () => {
  const panel = fn('buildMapPanel');
  const zoom = panel.indexOf('buildMapZoomControls()');
  const options = panel.indexOf('buildMapOptionsRow()');
  assert.ok(zoom !== -1 && options > zoom);
  const bar = fn('buildMapBar');
  assert.ok(bar.indexOf('buildViewPanelToggle(') > bar.indexOf('buildMapFilterRow()'), 'the panel button follows the pills, at the right, the side the panel comes out of');
  const body = fn('renderMapView');
  assert.match(body, /main\.appendChild\(buildMapBar\(panelOpen\)\)/);
  assert.doesNotMatch(body, /buildMapOptionsRow\(\)|buildMapZoomControls\(\)/, 'the view draws neither itself');
});

test('a click on an option button sets that option, checked ahead of the card and button handlers', () => {
  const click = appSrc.match(/\$\('#map-view'\)\.addEventListener\('click', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(click, 'the #map-view click listener is found');
  const handler = click[0];
  const option = handler.indexOf("closest('.map-option-btn[data-key][data-val]')");
  assert.ok(option !== -1, 'option buttons are looked up in the delegated listener');
  assert.match(handler, /setMapOption\(optionBtn\.dataset\.key, optionBtn\.dataset\.val\)/);
  assert.ok(option < handler.indexOf("closest('button[data-act]')"), 'an option click never falls through to a card action');
});

test('a focused option button blocks the poll and keeps a selection, like every other rebuilt control', () => {
  assertHoldsPoll(['.map-option-btn'], 'an option button');
  assertKeepsSelection(['.map-option-btn'], 'an option button');
});

test('the control row is styled with tokens, no hex outside the token blocks', () => {
  for (const sel of ['.map-options', '.map-option-btn', '.map-option-btn.active', '.map-option-label']) {
    assert.ok(cssSrc.includes(sel), `${sel} is styled`);
  }
  const rules = cssSrc.split('\n').filter((line) => /^\.map-option/.test(line));
  assert.ok(rules.length >= 4);
  for (const line of rules) assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b/, line);
});

// --- the row has no fold: the panel it stands in hides it ---------------------------

const { optionsRowSandbox } = require('./helpers/options-row');
const { assertKeepsSelection, assertHoldsPoll, assertLetsPollRun } = require('./helpers/markers');

const SECTIONS_KEY = 'kanban.shop.map.sections.collapsed';
const rowHtml = (opts) => { const w = optionsRowSandbox(opts); return { w, html: w.buildMapOptionsRow().outerHTML }; };

test('a board with no stored choice shows all eight controls and no toggle', () => {
  const { w, html } = rowHtml();
  assert.deepStrictEqual(groupsOf(html).map((g) => g.label), [
    'Parent lines', 'Dependency lines', 'Graphs', 'Parent sits', 'Align', 'Row order', 'Layout', 'Cards',
  ]);
  assert.ok(html.startsWith('<div class="map-options"><span class="map-option"'), 'the controls are the row itself, with no header ahead of them');
  assert.ok(html.endsWith(w.mapOptionsRowHtml(w.loadMapOptions()) + '</div>'), 'the controls are exactly what mapOptionsRowHtml draws');
  assert.doesNotMatch(html, /map-section|data-section|aria-expanded|<span>Options<\/span>/);
});

test('the controls show the options the board holds', () => {
  const stored = { 'kanban.shop.map.options': JSON.stringify({ parent: 'above', cards: 'plain' }) };
  const pressed = Object.fromEntries(groupsOf(rowHtml({ stored }).html).map((g) => [g.buttons[0].key, g.buttons.find((b) => b.pressed).val]));
  assert.strictEqual(pressed.parent, 'above');
  assert.strictEqual(pressed.cards, 'plain');
  assert.strictEqual(pressed.group, 'tree');
});

test('a fold saved for the row before the panel existed, or storage that is corrupt or blocked, changes nothing', () => {
  for (const raw of [JSON.stringify({ options: true }), JSON.stringify({ options: false }), '{not json', 'null', '"open"', '[]']) {
    assert.strictEqual(groupsOf(rowHtml({ stored: { [SECTIONS_KEY]: raw } }).html).length, 8, raw);
  }
  assert.strictEqual(groupsOf(rowHtml({ throws: true }).html).length, 8);
});

test('the Map\'s graphs and No relations sections keep their toggles, which keep the selection and leave the poll alone', () => {
  assertKeepsSelection(['.map-section-toggle'], 'a section toggle');
  assertLetsPollRun(['.map-section-toggle'], 'a section toggle');
});

test('the click listener handles the section toggles ahead of the option buttons and the card handlers', () => {
  const click = appSrc.match(/\$\('#map-view'\)\.addEventListener\('click', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(click, 'the #map-view click listener is found');
  const handler = click[0];
  const section = handler.indexOf("closest('.map-section-toggle[data-section]')");
  assert.ok(section !== -1);
  assert.match(handler, /keepControlFocus\(sectionBtn, \(\) => toggleMapSection\(sectionBtn\.dataset\.section\)\)/, 'focus follows the rebuilt toggle');
  assert.ok(section < handler.indexOf("closest('.map-option-btn[data-key][data-val]')"));
  assert.ok(section < handler.indexOf("closest('button[data-act]')"));
});

test('the stylesheet has no header rule left for the options row', () => {
  assert.ok(!cssSrc.split('\n').some((l) => l.startsWith('.map-options > .map-section-header')));
});
