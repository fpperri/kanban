'use strict';
// The card menu as app.html writes it, on elements a test can read back and drive (the document is
// helpers/palette-page.js's paletteDocument). The markup is parsed from the real file, so the tests
// run against the entries, groups and separators the page ships. Not a test file (the suite runs
// *.test.js only).
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8').replace(/\r\n/g, '\n');
const VOID = new Set(['hr', 'input', 'br']);

function menuMarkup() {
  const start = HTML.indexOf('<div id="context-menu"');
  const end = HTML.indexOf('<!-- Bulk-edit popups.');
  return HTML.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
}

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// -> { root, byId }: every element of the menu, the root first, each with its id, classes, attributes,
// data-* and (for a text-only element) its text.
function buildMenu(doc) {
  const byId = {};
  const stack = [];
  let root = null;
  const token = /<(\/?)([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  for (const m of menuMarkup().matchAll(token)) {
    if (m[4] !== undefined) {
      const text = m[4].replace(/\s+/g, ' ').trim();
      if (text && stack.length) stack[stack.length - 1].textContent = text;
      continue;
    }
    const [, closing, tag, attrs] = m;
    if (closing) { stack.pop(); continue; }
    const el = doc.createElement(tag);
    for (const a of attrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) {
      const [, name, value = ''] = a;
      if (name === 'class') el.className = value;
      else if (name === 'id') { el.id = value; byId[`#${value}`] = el; }
      else {
        el.setAttribute(name, value);
        if (name.startsWith('data-')) el.dataset[camel(name.slice(5))] = value;
      }
    }
    if (stack.length) stack[stack.length - 1].append(el);
    else root = el;
    if (!VOID.has(tag)) stack.push(el);
  }
  return { root, byId };
}

module.exports = { buildMenu };
