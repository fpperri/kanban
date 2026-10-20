'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The two markers the page reads instead of a list of selectors:
//   data-keeps-selection  a click on it (or inside it) never clears the selection
//   data-holds-poll       a focus on it (or inside it) holds the 5s refresh
// A control is named here by the selector the old lists used for it; tagsOf()
// returns the opening tag of every element the page builds for that name, built
// by the page's own code (a real builder run against a fake document, the
// markup a render template writes, or the static page), so a test can ask
// whether each one carries the marker.

const KEEPS = 'data-keeps-selection';
const HOLDS = 'data-holds-poll';

const WEB = path.join(__dirname, '..', '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const graphSrc = read('graph-view.js');
const html = read('app.html');
const statusesSrc = read('search-statuses.js');

function fn(name, src = appSrc) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found`);
  return m[0];
}

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function fakeNode(tag) {
  return {
    tag, className: '', dataset: {}, attrs: {}, style: {}, children: [], hidden: false, title: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    addEventListener() {},
    get tagText() {
      const data = Object.entries(this.dataset).map(([k, v]) => `data-${kebab(k)}="${v}"`);
      const attrs = Object.entries(this.attrs).map(([k, v]) => `${k}="${v}"`);
      return `<${this.tag} class="${this.className}" ${[...data, ...attrs].join(' ')}>`;
    },
  };
}

const classToken = (cls) => `(?<![\\w-])${cls}(?![\\w-])`;

function staticTag(id) {
  const m = html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`));
  assert.ok(m, `#${id} is in app.html`);
  return [m[0]];
}

function templateSites(src, cls) {
  const re = new RegExp(`class="[^"]*${classToken(cls)}`);
  return src.split('\n').filter((l) => !/^\s*\/\//.test(l) && re.test(l));
}

function pillTags(pillClass) {
  const sandbox = { document: { createElement: fakeNode }, columnLabel: (c) => c, statusColorVar: () => '' };
  vm.runInNewContext(fn('buildFilterPillRow'), sandbox);
  return sandbox.buildFilterPillRow({}, ['todo', 'archive'], 'row', pillClass, () => 'title').children.map((b) => b.tagText);
}

function statusPillTags() {
  const sandbox = { columnLabel: (c) => c, statusColorVar: () => '', statusFilterTitle: () => 'title' };
  vm.runInNewContext(fn('statusPillTitle', statusesSrc) + fn('buildStatusPill', statusesSrc) + fn('updateStatusPill', statusesSrc) + 'const STATUS_PILL_SOLO_HINT = "";', sandbox);
  const node = (tag) => Object.assign(fakeNode(tag), {
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    classList: { toggle() {} },
  });
  return ['todo', 'archive'].map((col) => sandbox.buildStatusPill({ createElement: node }, 'gantt', col, true).tagText);
}

function graphButtonTags() {
  const sandbox = { document: { createElement: fakeNode } };
  vm.runInNewContext(fn('graphButton', graphSrc), sandbox);
  return [
    sandbox.graphButton('graph-layout-btn', 'Tiers', 'title', { layout: 'tiers' }),
    sandbox.graphButton('graph-zoom-btn', '+', 'title', { graphAction: 'in' }),
  ].map((b) => b.tagText);
}

function zoomTags() {
  const sandbox = { document: { createElement: fakeNode }, loadMapZoom: () => 1, MAP_ZOOM_MIN: 0.5, MAP_ZOOM_MAX: 2 };
  vm.runInNewContext(fn('buildMapZoomControls'), sandbox);
  return sandbox.buildMapZoomControls().children.filter((c) => c.tag === 'button').map((b) => b.tagText);
}

function optionsRowHtml() {
  const { optionsRowSandbox } = require('./options-row');
  return optionsRowSandbox().buildMapOptionsRow().outerHTML;
}

// The fold toggle of each of the Map's collapsible sections, folded and open.
function sectionToggleTags() {
  const { escapeHtml } = require('../../web/assignee-badge');
  const sandbox = { document: { createElement: fakeNode }, escapeHtml, CHEVRON_LEFT_ICON: '<svg></svg>', CHEVRON_RIGHT_ICON: '<svg></svg>' };
  vm.runInNewContext(fn('buildMapSectionHeader'), sandbox);
  return ['graph', 'isolated'].flatMap((section) => [true, false].flatMap((folded) => tagsIn(sandbox.buildMapSectionHeader(section, 'Label', folded).innerHTML, 'map-section-toggle')));
}

// The panel's icon button and its close button, as the page builds them.
function panelButtonTags() {
  const sandbox = { document: { createElement: fakeNode }, VIEW_PANEL_ICON: '<svg></svg>' };
  vm.runInNewContext([fn('buildViewPanelToggle'), fn('buildViewPanel')].join('\n'), sandbox);
  const panel = sandbox.buildViewPanel('map', 'label');
  return [sandbox.buildViewPanelToggle('map', 'title', true).tagText, ...panel.children.filter((c) => c.tag === 'button').map((b) => b.tagText)];
}

const tagsIn = (markup, cls) => (markup.match(new RegExp(`<[a-z]+[^>]*class="[^"]*${classToken(cls)}[^"]*"[^>]*>`, 'g')) || []);

function rollupTags() {
  const { rollupBar } = require('../../web/rollup-bar');
  const rollup = { total: 3, counts: { todo: 1, done: 2 }, scope: { board: 'shop' } };
  return ['open', 'collapsed'].flatMap((mode) => tagsIn(rollupBar(rollup, mode, ['todo', 'done']), 'rollup'));
}

function datePickerTags() {
  const body = { appendChild() {} };
  const sandbox = { document: { querySelector: () => null, createElement: fakeNode, body } };
  vm.runInNewContext(fn('datePickerPop'), sandbox);
  return [sandbox.datePickerPop().tagText];
}

// A built control read back as the element a browser would hold: the classes
// and the data attributes of its opening tag.
function elementOf(tag) {
  const cls = (tag.match(/class="([^"]*)"/) || [null, ''])[1];
  const dataset = {};
  for (const m of tag.matchAll(/\sdata-([\w-]+)(?:="([^"]*)")?/g)) dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = m[2] === undefined ? '' : m[2];
  return { classList: cls.split(/\s+/).filter(Boolean), dataset };
}

const STATIC = (id) => () => staticTag(id);
const SITES = (cls) => () => templateSites(appSrc, cls);

const CONTROLS = {
  '#context-menu': STATIC('context-menu'),
  '#detail-modal': STATIC('detail-modal'),
  '#bulk-single': STATIC('bulk-single'),
  '#bulk-tags': STATIC('bulk-tags'),
  '#bulk-schedule': STATIC('bulk-schedule'),
  '#bulk-archive': STATIC('bulk-archive'),
  '#map-toggle-btn': STATIC('map-toggle-btn'),
  '#calendar-toggle-btn': STATIC('calendar-toggle-btn'),
  '#gantt-toggle-btn': STATIC('gantt-toggle-btn'),
  '#graph-toggle-btn': STATIC('graph-toggle-btn'),
  '.date-picker-pop': datePickerTags,
  '.cal-nav': SITES('cal-nav'),
  '.cal-span-cycle': SITES('cal-span-cycle'),
  '.map-filter-toggle': () => pillTags('map-filter-toggle'),
  '.gantt-filter-toggle': () => pillTags('gantt-filter-toggle'),
  '.calendar-filter-toggle': () => pillTags('calendar-filter-toggle'),
  '.graph-filter-toggle': () => pillTags('graph-filter-toggle graph-control'),
  '.status-pill': statusPillTags,
  '.map-section-toggle': sectionToggleTags,
  '.view-panel-toggle': () => panelButtonTags().slice(0, 1),
  '.view-panel-close': () => panelButtonTags().slice(1),
  '.map-zoom-btn': zoomTags,
  '.map-option-btn': () => tagsIn(optionsRowHtml(), 'map-option-btn'),
  '.rollup': rollupTags,
  '.graph-control': () => [...graphButtonTags(), ...pillTags('graph-filter-toggle graph-control')],
  '.graph-button': graphButtonTags,
  '.column-sort-field': SITES('column-sort-field'),
  '.column-sort-dir': SITES('column-sort-dir'),
  '.column-add': SITES('column-add'),
  '.column-add-ai': SITES('column-add-ai'),
};

function tagsOf(selector) {
  assert.ok(CONTROLS[selector], `${selector} is a control the markers know`);
  const tags = CONTROLS[selector]();
  assert.ok(tags.length > 0, `the page builds ${selector} somewhere`);
  return tags;
}

function assertAll(selectors, attr, present, what) {
  for (const selector of selectors) {
    for (const tag of tagsOf(selector)) {
      assert.strictEqual(tag.includes(attr), present, `${what}: ${selector} ${present ? 'must carry' : 'must not carry'} ${attr} in ${tag.trim()}`);
    }
  }
}

const assertKeepsSelection = (selectors, what = 'the control') => assertAll(selectors, KEEPS, true, what);
const assertHoldsPoll = (selectors, what = 'the control') => assertAll(selectors, HOLDS, true, what);
const assertLetsPollRun = (selectors, what = 'the control') => assertAll(selectors, HOLDS, false, what);

module.exports = { KEEPS, HOLDS, tagsOf, elementOf, assertKeepsSelection, assertHoldsPoll, assertLetsPollRun, fakeNode, fn, appSrc, graphSrc, html };
