'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function line(re, what) {
  const m = appSrc.match(re);
  assert.ok(m, `${what} found in app.js`);
  return m[0];
}

// An element that remembers its content in order, so a row built by appendChild
// and insertAdjacentHTML serialises the way the browser would lay it out.
function fakeEl(tag) {
  const el = {
    tag, className: '', parts: [],
    set innerHTML(html) { this.parts = [html]; },
    get innerHTML() { return this.parts.map((p) => (typeof p === 'string' ? p : p.outerHTML)).join(''); },
    get outerHTML() { return `<${tag} class="${this.className}">${this.innerHTML}</${tag}>`; },
    appendChild(c) { this.parts.push(c); return c; },
    insertAdjacentHTML(pos, html) { assert.strictEqual(pos, 'beforeend'); this.parts.push(html); },
  };
  return el;
}

// The real row builders against a fake localStorage and a fake document: what
// the Map's options row shows for a given stored choice is what is under test.
function optionsRowSandbox({ stored = {}, throws = false, board = 'shop' } = {}) {
  const { storageKey, mergeMapSectionsCollapsed } = require('../../web/column-state');
  const { MAP_OPTION_VALUES, mergeMapOptions } = require('../../web/map-relations');
  const { escapeHtml } = require('../../web/assignee-badge');
  const writes = {};
  const sandbox = {
    state: { projectName: board },
    document: { createElement: fakeEl },
    storageKey, mergeMapSectionsCollapsed, mergeMapOptions, MAP_OPTION_VALUES, escapeHtml,
    renders: 0,
    renderBoard() { sandbox.renders++; },
    writes,
    localStorage: {
      getItem(k) { if (throws) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      setItem(k, v) { if (throws) throw new Error('blocked'); writes[k] = v; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    line(/const CHEVRON_LEFT_ICON = .*;/, 'CHEVRON_LEFT_ICON'),
    line(/const CHEVRON_RIGHT_ICON = .*;/, 'CHEVRON_RIGHT_ICON'),
    line(/const MAP_OPTION_LABELS = \{[\s\S]*?\n\};/, 'MAP_OPTION_LABELS'),
    'let mapSectionsCollapsed = null; let mapOptions = null;',
    fn('loadMapSectionsCollapsed'), fn('saveMapSectionsCollapsed'), fn('toggleMapSection'),
    fn('loadMapOptions'), fn('buildMapSectionHeader'), fn('mapOptionsRowHtml'), fn('buildMapOptionsRow'),
    'this.CHEVRON_LEFT_ICON = CHEVRON_LEFT_ICON; this.CHEVRON_RIGHT_ICON = CHEVRON_RIGHT_ICON;',
  ].join('\n'), sandbox);
  return sandbox;
}

const TOGGLE_RE = /<button type="button" class="([^"]*)" data-section="options" aria-label="([^"]*)" aria-expanded="(true|false)">([\s\S]*?)<\/button>/;

// The Options toggle of a built row, read back as the element a browser would
// hold: its classes, its data-section and its aria state.
function optionsToggleOf(rowHtml) {
  const m = rowHtml.match(TOGGLE_RE);
  if (!m) return null;
  return { classList: m[1].split(/\s+/).filter(Boolean), dataset: { section: 'options' }, label: m[2], expanded: m[3] === 'true', icon: m[4] };
}

module.exports = { appSrc, fn, optionsRowSandbox, optionsToggleOf };
