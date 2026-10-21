'use strict';
// A small tree of elements a page script can build, query and change, for tests that run a script
// in a vm: createElement, attributes, classes, children, closest and querySelectorAll over a handful
// of selector forms (a tag, .class, [attr], tag[attr], tag.class, and a descendant chain of these),
// layout answered by a flag each element carries, and events delivered by hand. Not a test file (the
// suite runs *.test.js only).

class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.shown = true;
    this.style = {};
    this.textContent = '';
    this.contentWindow = { posted: [], postMessage: (message, target) => this.contentWindow.posted.push([message, target]) };
  }

  get tag() { return this.tagName.toLowerCase(); }

  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.documentElement) return true; return false; }

  get nextSibling() {
    if (!this.parentNode) return null;
    const at = this.parentNode.children.indexOf(this);
    return this.parentNode.children[at + 1] || null;
  }

  get classes() { return this.className.split(/\s+/).filter(Boolean); }

  get classList() {
    const self = this;
    return {
      add: (...c) => { self.className = [...new Set(self.classes.concat(c))].join(' '); },
      remove: (...c) => { self.className = self.classes.filter((x) => !c.includes(x)).join(' '); },
      contains: (c) => self.classes.includes(c),
      toggle(c, force) { const on = force === undefined ? !self.classes.includes(c) : !!force; if (on) this.add(c); else this.remove(c); return on; },
    };
  }

  setAttribute(k, v) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }

  getAttribute(k) { if (k === 'class') return this.className || null; return k in this.attrs ? this.attrs[k] : null; }

  hasAttribute(k) { return this.getAttribute(k) !== null; }

  get dataset() {
    const self = this;
    return new Proxy({}, {
      get: (t, k) => self.attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`],
      set: (t, k, v) => { self.attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(v); return true; },
    });
  }

  addEventListener(type, fn, capture) { (this.listeners[type] = this.listeners[type] || []).push({ fn, capture: !!capture }); }

  fire(type, event = {}) {
    for (const { fn } of (this.listeners[type] || []).slice()) fn({ target: this, ...event });
  }

  _detach(n) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n);
    n.parentNode = this;
  }

  appendChild(n) { this._detach(n); this.children.push(n); return n; }

  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }

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

  getClientRects() { return this.visible() ? [{}] : []; }

  // An element has layout unless it or an ancestor is hidden, or is a closed <details> and the element is not its summary.
  visible() {
    for (let n = this, child = null; n; child = n, n = n.parentNode) {
      if (n.hidden || n.shown === false) return false;
      if (n.tag === 'details' && !n.hasAttribute('open') && child && child.tag !== 'summary') return false;
    }
    return true;
  }

  closest(selector) {
    for (let n = this; n && n.tagName; n = n.parentNode) if (matches(n, selector)) return n;
    return null;
  }

  querySelectorAll(selector) {
    const chain = selector.trim().split(/\s+/);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (matchesChain(c, chain, this)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  walk() { return [this].concat(...this.children.map((c) => c.walk())); }
}

function matches(node, simple) {
  const m = /^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(simple);
  if (!m) throw new Error(`mini-dom does not read the selector "${simple}"`);
  if (m[1] && node.tag !== m[1].toLowerCase()) return false;
  for (const cls of m[2].split('.').filter(Boolean)) if (!node.classes.includes(cls)) return false;
  for (const a of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const v = node.getAttribute(a[1]);
    if (v === null || (a[2] !== undefined && v !== a[2])) return false;
  }
  return true;
}

function matchesChain(node, chain, scope) {
  if (!matches(node, chain[chain.length - 1])) return false;
  let at = chain.length - 2;
  for (let p = node.parentNode; at >= 0 && p && p !== scope.parentNode; p = p.parentNode) if (matches(p, chain[at])) at--;
  return at < 0;
}

function miniDocument() {
  const listeners = {};
  const doc = {
    createElement: (tag) => new Node(tag, doc),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    listeners,
  };
  doc.documentElement = new Node('html', doc);
  doc.head = doc.documentElement.appendChild(new Node('head', doc));
  doc.body = doc.documentElement.appendChild(new Node('body', doc));
  return doc;
}

module.exports = { Node, miniDocument };
