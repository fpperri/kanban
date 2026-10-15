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

test('the options row sits between the status pills and the zoom controls', () => {
  const body = fn('renderMapView');
  const pills = body.indexOf('buildMapFilterRow()');
  const options = body.indexOf('buildMapOptionsRow()');
  const zoom = body.indexOf('buildMapZoomControls()');
  assert.ok(pills !== -1 && options > pills && zoom > options);
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

// --- the fold: the row starts folded behind an Options toggle ---------------------

const { optionsRowSandbox, optionsToggleOf } = require('./helpers/options-row');
const { assertKeepsSelection, assertHoldsPoll, assertLetsPollRun } = require('./helpers/markers');

const SECTIONS_KEY = 'kanban.shop.map.sections.collapsed';
const unfolded = (extra = {}) => ({ [SECTIONS_KEY]: JSON.stringify({ options: false, ...extra }) });
const rowHtml = (opts) => { const w = optionsRowSandbox(opts); return { w, html: w.buildMapOptionsRow().outerHTML }; };
const controlsIn = (html) => groupsOf(html);
const toggleIn = (html) => { const t = optionsToggleOf(html); assert.ok(t, 'the Options toggle is in the row'); return t; };

test('a board with no stored choice shows the Options toggle and hides the row', () => {
  const { w, html } = rowHtml();
  const toggle = toggleIn(html);
  assert.strictEqual(toggle.expanded, false);
  assert.strictEqual(toggle.label, 'Expand Options');
  assert.strictEqual(toggle.icon, w.CHEVRON_RIGHT_ICON, 'folded wears the same chevron the folded sections wear');
  assert.match(html, /<span>Options<\/span>/);
  assert.deepStrictEqual(controlsIn(html), [], 'no control is drawn while folded');
  assert.doesNotMatch(html, /map-option-btn/);
});

test('unfolded, the row holds the same eight controls the always-shown row held', () => {
  const { w, html } = rowHtml({ stored: unfolded() });
  const toggle = toggleIn(html);
  assert.strictEqual(toggle.expanded, true);
  assert.strictEqual(toggle.label, 'Collapse Options');
  assert.strictEqual(toggle.icon, w.CHEVRON_LEFT_ICON, 'unfolded wears the chevron the open sections wear');
  assert.deepStrictEqual(controlsIn(html).map((g) => g.label), [
    'Parent lines', 'Dependency lines', 'Graphs', 'Parent sits', 'Align', 'Row order', 'Layout', 'Cards',
  ]);
  assert.ok(html.endsWith(w.mapOptionsRowHtml(w.loadMapOptions()) + '</div>'), 'the controls are exactly what mapOptionsRowHtml draws');
});

test('unfolded, the controls show the options the board holds', () => {
  const stored = { ...unfolded(), 'kanban.shop.map.options': JSON.stringify({ parent: 'above', cards: 'plain' }) };
  const { html } = rowHtml({ stored });
  assert.strictEqual(toggleIn(html).expanded, true);
  const pressed = Object.fromEntries(controlsIn(html).map((g) => [g.buttons[0].key, g.buttons.find((b) => b.pressed).val]));
  assert.strictEqual(pressed.parent, 'above');
  assert.strictEqual(pressed.cards, 'plain');
  assert.strictEqual(pressed.group, 'tree');
});

test('the toggle sits where the row starts, ahead of every control, in the one .map-options row', () => {
  for (const stored of [{}, unfolded()]) {
    const { html } = rowHtml({ stored });
    assert.match(html, /^<div class="map-options"><div class="map-section-header">/);
    const toggleAt = html.indexOf('data-section="options"');
    assert.ok(toggleAt !== -1);
    if (html.includes('class="map-option"')) assert.ok(toggleAt < html.indexOf('class="map-option"'));
  }
});

test('the toggle is a section toggle: its own button, labelled Options, named for its section, with no inline style', () => {
  for (const stored of [{}, unfolded()]) {
    const { html } = rowHtml({ stored });
    const toggle = toggleIn(html);
    assert.deepStrictEqual(toggle.classList, ['map-section-toggle'], 'the same class the Map\'s other fold toggles carry');
    assert.match(html, /<button type="button" class="map-section-toggle" data-section="options"/, 'a real button: Tab reaches it, Enter and Space press it');
    assert.doesNotMatch(html, /\sstyle=/);
    assert.doesNotMatch(html, /tabindex/);
  }
});

test('storage that is corrupt, wrong-shaped or blocked leaves the row folded', () => {
  for (const raw of ['{not json', 'null', '"open"', '42', '{"options":"no"}', '{"options":null}', '[]']) {
    const { html } = rowHtml({ stored: { [SECTIONS_KEY]: raw } });
    assert.strictEqual(toggleIn(html).expanded, false, raw);
    assert.deepStrictEqual(controlsIn(html), [], raw);
  }
  const blocked = rowHtml({ throws: true }).html;
  assert.strictEqual(toggleIn(blocked).expanded, false);
  assert.deepStrictEqual(controlsIn(blocked), []);
});

test('a board that only ever folded its graphs or No relations row still opens with the options folded', () => {
  const { html } = rowHtml({ stored: { [SECTIONS_KEY]: JSON.stringify({ graph: true, isolated: false }) } });
  assert.strictEqual(toggleIn(html).expanded, false);
  assert.deepStrictEqual(controlsIn(html), []);
});

test('a click on the Options toggle goes through the section branch, ahead of the option buttons and the card handlers', () => {
  const toggle = toggleIn(rowHtml().html);
  assert.ok(toggle.classList.includes('map-section-toggle') && toggle.dataset.section === 'options', 'the toggle matches .map-section-toggle[data-section]');
  const click = appSrc.match(/\$\('#map-view'\)\.addEventListener\('click', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(click, 'the #map-view click listener is found');
  const handler = click[0];
  const section = handler.indexOf("closest('.map-section-toggle[data-section]')");
  assert.ok(section !== -1);
  assert.match(handler, /keepPillFocus\(sectionBtn, \(\) => toggleMapSection\(sectionBtn\.dataset\.section\)\)/, 'focus follows the rebuilt toggle');
  assert.ok(section < handler.indexOf("closest('.map-option-btn[data-key][data-val]')"));
  assert.ok(section < handler.indexOf("closest('button[data-act]')"));
});

test('a click on the Options toggle does not wipe a building selection', () => {
  for (const stored of [{}, unfolded()]) assert.strictEqual(toggleIn(rowHtml({ stored }).html).keepsSelection, true, 'the toggle wears the keep-selection marker');
  assertKeepsSelection(['.map-section-toggle'], 'a section toggle');
});

test('the Options toggle does not hold the poll, so a focused one does not hold the 5s refresh', () => {
  assertLetsPollRun(['.map-section-toggle'], 'a section toggle');
});

test('the Options toggle sits inline with the row and drops the section header\'s own bottom margin', () => {
  const rule = cssSrc.split('\n').find((l) => l.startsWith('.map-options > .map-section-header'));
  assert.ok(rule, 'a rule for the header inside the options row');
  assert.match(rule, /margin-bottom: 0/);
  assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,8}\b/);
});
