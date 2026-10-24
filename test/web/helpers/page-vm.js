'use strict';
// The real page, run in a vm. Every script app.html loads goes into one
// context in the order the page loads them, so the scope is the page's scope;
// the DOM is the thin stand-in the tests need. Anything the page reaches for
// that is not named below answers like a harmless element: any property is a
// new such stand-in, a call returns one, a write is dropped. The search box,
// its clear button, the card menu's Path and Tree items and the document are
// real enough to be driven and watched; a test may hand in more elements to
// drive, by selector, through the `elements` option, and `documentExtras` puts
// more members on the document (a createElement that makes elements a test can
// watch). Not a test file (the suite runs *.test.js only).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'web', 'web');

function harmless(label) {
  return new Proxy(function () {}, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      if (key === Symbol.iterator) return function* () {};
      return harmless(`${label}.${String(key)}`);
    },
    apply() { return harmless(`${label}()`); },
    construct() { return harmless(`new ${label}`); },
    set() { return true; },
  });
}

function classList() {
  const names = new Set();
  return {
    add: (c) => names.add(c),
    remove: (c) => names.delete(c),
    toggle: (c, force) => { if (force === undefined ? !names.has(c) : force) names.add(c); else names.delete(c); return names.has(c); },
    contains: (c) => names.has(c),
  };
}

function control() {
  const el = {
    listeners: {},
    classList: classList(),
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    fire(type, event = {}) { (el.listeners[type] || []).slice().forEach((fn) => fn(event)); },
    focus() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };
  return new Proxy(el, {
    get: (target, key) => (key in target ? target[key] : harmless(String(key))),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

// The search box keeps what the page wrote to it apart from what a person
// typed: `writes` lists every value the page assigned, in order.
function searchBox() {
  const box = control();
  let value = '';
  let range = null;
  Object.defineProperties(box, {
    value: {
      get: () => value,
      set: (v) => { value = String(v); box.writes.push(value); },
    },
    selectionStart: { get: () => (range ? range[0] : value.length) },
  });
  box.writes = [];
  box.setSelectionRange = (a, b) => { range = [a, b]; };
  box.select = () => { range = [0, value.length]; };
  box.typed = (text, selectionStart) => {
    value = text;
    range = [selectionStart === undefined ? text.length : selectionStart, text.length];
    box.fire('input', { isTrusted: true });
  };
  return box;
}

// A selector ending :not(.hidden) asks whether a surface is open; the fake page
// answers that none is, so the key guard sees a quiet page.
const OPEN_SURFACE_PROBE = /:not\(\.hidden\)$/;

function loadPage({ board, search = '', stored = {}, scripts, elements: more = {}, documentExtras = {} } = {}) {
  const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  const files = scripts || [...html.matchAll(/<script src="\/([^"]+)"/g)].map((m) => m[1]);
  const input = searchBox();
  const clear = control();
  const menu = { hpath: control(), htree: control(), dpath: control(), dtree: control() };
  const documentListeners = {};
  const windowListeners = {};
  const failures = [];
  const elements = { '#search-input': input, '#search-clear-btn': clear, '#ctx-hpath': menu.hpath, '#ctx-htree': menu.htree, '#ctx-dpath': menu.dpath, '#ctx-dtree': menu.dtree, ...more };
  const doc = new Proxy({
    activeElement: null,
    visibilityState: 'visible',
    ...documentExtras,
    addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    querySelector: (sel) => {
      if (sel in elements) return elements[sel];
      if (OPEN_SURFACE_PROBE.test(sel)) return null;
      return control();
    },
    getElementById: (id) => elements[`#${id}`] || control(),
  }, { get: (target, key) => (key in target ? target[key] : harmless(`document.${String(key)}`)), set: (t, k, v) => { t[k] = v; return true; } });

  const fetchLog = [];
  const ctx = vm.createContext({ console });
  Object.assign(ctx, {
    window: ctx,
    self: ctx,
    document: doc,
    location: { search, pathname: '/', href: `http://localhost/${search}` },
    localStorage: {
      getItem: (k) => (k in stored ? stored[k] : null),
      setItem: (k, v) => { stored[k] = String(v); },
      removeItem: (k) => { delete stored[k]; },
    },
    history: harmless('history'),
    navigator: harmless('navigator'),
    innerWidth: 1600,
    innerHeight: 1000,
    addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    getComputedStyle: () => harmless('computedStyle'),
    getSelection: () => ({ isCollapsed: true }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class { observe() {} disconnect() {} },
    URLSearchParams,
    Event,
    CustomEvent: Event,
    fetch: async (url) => {
      fetchLog.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(board),
      };
    },
  });
  for (const file of files) {
    try { vm.runInContext(fs.readFileSync(path.join(WEB, file), 'utf8'), ctx, { filename: file }); }
    catch (e) { throw new Error(`${file} did not load in the page scope: ${e.message}`); }
  }

  const page = {
    ctx, input, clear, menu, failures, fetchLog, documentListeners, windowListeners,
    run: (code) => vm.runInContext(code, ctx),
    // Everything the page does when it is ready: each DOMContentLoaded
    // listener in registration order, then the first board load settles.
    async start() {
      for (const fn of windowListeners.DOMContentLoaded || []) {
        try { fn({}); } catch (e) { failures.push(e); }
      }
      await page.settle();
      return page;
    },
    async settle() {
      for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
    },
    // A key or click on the document, as the page's own listeners see it.
    fireDocument(type, event) {
      const e = Object.assign({ preventDefault() {}, stopPropagation() {} }, event);
      (documentListeners[type] || []).slice().forEach((fn) => fn(e));
      return e;
    },
    // A right-click on a card's tile, as the page's document listeners see it.
    rightClickCard(id) {
      const tile = { dataset: { id: String(id) } };
      return page.fireDocument('contextmenu', { target: { closest: (sel) => (sel === '.card-el' ? tile : null) }, clientX: 0, clientY: 0 });
    },
  };
  return page;
}

module.exports = { loadPage, harmless, control };
