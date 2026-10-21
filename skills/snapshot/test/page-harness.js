// Runs a built snapshot page for real, in a vm, against a small stand-in for
// the DOM: enough of createElement, the tree, classList, dataset and event
// listeners for the page's own render() and click handler to run, so a test
// can look at the cards it draws and click what a person would tap. Not a test
// file (the suite runs *.test.js only).
const vm = require('node:vm');

class Text {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
}

const camel = (attr) => attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class El {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.dataset = new Proxy({}, { set(t, k, v) { t[k] = String(v); return true; } });
    this.style = { cssText: '' };
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.id = '';
    this.value = '';
    this._text = '';
    this.scrollTop = 0;
  }

  get id() { return this._id; }

  // An element is found by its id as soon as it has one, the way a page's own
  // getElementById finds what render() just built.
  set id(v) {
    this._id = v;
    if (v) this.ownerDocument.ids.set(v, this);
  }

  get classList() {
    const self = this;
    const names = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add(...c) { self.className = [...new Set(names().concat(c))].join(' '); },
      remove(...c) { self.className = names().filter((n) => !c.includes(n)).join(' '); },
      contains: (c) => names().includes(c),
      toggle(c, force) {
        const on = force === undefined ? !names().includes(c) : force;
        if (on) this.add(c); else this.remove(c);
        return on;
      },
    };
  }

  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) { this.children = []; this._text = String(v); }

  set innerHTML(v) { this.children = []; this._text = ''; this._html = String(v); }

  get innerHTML() { return this._html || ''; }

  get firstChild() { return this.children[0] || null; }

  // Whether the element hangs from the page's body, as in a browser.
  get isConnected() {
    for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.body) return true;
    return false;
  }

  _detach(n) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n);
    n.parentNode = this;
  }

  appendChild(n) { this._detach(n); this.children.push(n); return n; }

  insertBefore(n, ref) {
    this._detach(n);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at === -1) this.children.push(n); else this.children.splice(at, 0, n);
    return n;
  }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    nodes.forEach((n) => this.appendChild(n));
  }

  setAttribute(k, v) {
    if (k.startsWith('data-')) this.dataset[camel(k)] = String(v);
    else if (k === 'class') this.className = String(v);
    else this.attrs[k] = String(v);
  }

  getAttribute(k) {
    if (k.startsWith('data-')) return camel(k) in this.dataset ? this.dataset[camel(k)] : null;
    return k in this.attrs ? this.attrs[k] : null;
  }

  removeAttribute(k) {
    if (k.startsWith('data-')) delete this.dataset[camel(k)];
    else delete this.attrs[k];
  }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

  matches(selector) {
    return selector.split(',').some((part) => {
      const s = part.trim();
      if (s.startsWith('[')) return camel(s.slice(1, -1)) in this.dataset;
      if (s.startsWith('#')) return this.id === s.slice(1);
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      return this.tagName === s.toUpperCase();
    });
  }

  closest(selector) {
    for (let n = this; n; n = n.parentNode) if (n.nodeType === 1 && n.matches(selector)) return n;
    return null;
  }

  all() {
    return this.children.filter((c) => c.nodeType === 1).flatMap((c) => [c, ...c.all()]);
  }

  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }

  scrollTo() {}

  // Focus moves to this element, and its own focus listeners hear of it, as in a browser.
  focus(opts) {
    const moved = this.ownerDocument.activeElement !== this;
    this.ownerDocument.activeElement = this;
    this.focusOpts = opts;
    if (moved) for (const fn of this.listeners.focus || []) fn({ target: this });
  }

  querySelectorAll(selector) {
    const attrs = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [camel(m[1]), m[2]]);
    return this.all().filter((n) => attrs.every(([k, v]) => n.dataset[k] === v));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  select() {}

  setSelectionRange() {}

  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }

  get clientWidth() { return 0; }
}

// html: the built page text. opts.matchMedia(query) answers the media queries;
// opts.console stands in for the page's console, so a test can see what it logs.
function loadPage(html, opts = {}) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // The page's markup is not parsed, so an element is made when the page first asks for it by id;
  // it is made as the kind of element the markup says it is (a button, an input), so what a control
  // is for the page's own checks (closest('button'), an input having focus) is what it is in a browser.
  const markup = html.slice(0, html.indexOf('<script>'));
  const tagOfId = (id) => {
    const m = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)[ ]([^>]*[ ])?id="${id.replace(/[^a-z0-9-]/gi, '')}"`).exec(markup);
    return m ? m[1] : 'div';
  };
  const doc = {
    body: null,
    activeElement: null,
    visibilityState: 'visible',
    listeners: {},
    createElement: (tag) => new El(tag, doc),
    createElementNS: (ns, tag) => new El(tag, doc),
    createTextNode: (text) => new Text(text),
    ids: new Map(),
    getElementById(id) {
      if (!doc.ids.has(id)) { const e = new El(tagOfId(id), doc); e.id = id; }
      return doc.ids.get(id);
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    execCommand: () => true,
  };
  doc.body = new El('body', doc);
  doc.head = new El('head', doc);
  doc.documentElement = new El('html', doc);
  const store = new Map();
  const ctx = {
    document: doc,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: (q) => ({ matches: opts.matchMedia ? !!opts.matchMedia(q) : false, addEventListener() {} }),
    addEventListener() {},
    innerWidth: 1024,
    innerHeight: 768,
    console: opts.console || console,
    MutationObserver: class { observe() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `page-script-${i}.js` }).runInContext(ctx));

  const page = {
    scripts,
    byId: (id) => doc.getElementById(id),
    // Evaluate an expression among the page's own top-level names.
    run: (code) => new vm.Script(code).runInContext(ctx),
    // What a person tapping `target` sets off: the page's one delegated click handler.
    click(target) {
      const ev = { target, stopPropagation() {}, preventDefault() {} };
      for (const fn of doc.body.listeners.click || []) fn(ev);
    },
    // A right-click (or the ContextMenu key) on target; reports whether the page kept the browser menu away.
    contextmenu(target) {
      let prevented = false;
      const ev = { target, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() { prevented = true; } };
      for (const fn of doc.body.listeners.contextmenu || []) fn(ev);
      return prevented;
    },
    // A key pressed with focus on target: the listeners of target and of each element above it hear
    // it, then the document's, as the event bubbles, unless one of them stops it; reports whether the
    // page kept the browser's own action away.
    key(target, key, mods = {}) {
      let prevented = false;
      let stopped = false;
      const ev = { key, target, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, getModifierState: () => false, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...mods };
      for (let n = target; n && !stopped; n = n.parentNode) for (const fn of n.listeners.keydown || []) fn(ev);
      if (!stopped) for (const fn of doc.listeners.keydown || []) fn(ev);
      return prevented;
    },
    // A press of the mouse button on target, which the page's document-level listeners hear.
    mousedown(target) {
      const ev = { target, preventDefault() {}, stopPropagation() {} };
      for (const fn of doc.listeners.mousedown || []) fn(ev);
    },
    change(target) {
      const ev = { target, stopPropagation() {}, preventDefault() {} };
      for (const fn of doc.body.listeners.change || []) fn(ev);
    },
    // Typing into an element: set its value, then fire its own input listeners.
    type(target, value) {
      target.value = value;
      for (const fn of target.listeners.input || []) fn({ target });
    },
    // Plain JSON copy: the page lives in its own realm, so its arrays and objects
    // never compare equal to the test's until they cross as JSON.
    plain: (v) => JSON.parse(JSON.stringify(v)),
  };
  return page;
}

// The elements under root (root included) that carry the class.
function byClass(root, cls) {
  return [root, ...root.all()].filter((n) => n.classList.contains(cls));
}

module.exports = { El, loadPage, byClass };
