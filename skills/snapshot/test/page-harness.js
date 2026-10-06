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

  removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; return n; }

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

  removeAttribute(k) { if (k.startsWith('data-')) delete this.dataset[camel(k)]; else delete this.attrs[k]; }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

  removeEventListener() {}

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

  querySelectorAll(selector) { return this.all().filter((n) => n.matches(selector)); }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }

  scrollTo() {}

  focus() {}

  select() {}

  setSelectionRange() {}

  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }

  get clientWidth() { return 0; }
}

// html: the built page text. opts.matchMedia(query) answers the media queries.
function loadPage(html, opts = {}) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
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
      if (!doc.ids.has(id)) { const e = new El('div', doc); e.id = id; }
      return doc.ids.get(id);
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    execCommand: () => true,
  };
  doc.body = new El('body', doc);
  const store = new Map();
  const ctx = {
    document: doc,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: (q) => ({ matches: opts.matchMedia ? !!opts.matchMedia(q) : false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    innerWidth: 1024,
    innerHeight: 768,
    console,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  scripts.forEach((src, i) => new vm.Script(src, { filename: `page-script-${i}.js` }).runInContext(ctx));

  const page = {
    scripts,
    document: doc,
    byId: (id) => doc.getElementById(id),
    // Evaluate an expression among the page's own top-level names.
    run: (code) => new vm.Script(code).runInContext(ctx),
    // What a person tapping `target` sets off: the page's one delegated click handler.
    click(target) {
      const ev = { target, stopPropagation() {}, preventDefault() {} };
      for (const fn of doc.body.listeners.click || []) fn(ev);
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
