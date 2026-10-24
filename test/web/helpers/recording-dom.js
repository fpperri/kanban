'use strict';
// Elements a test can read back. Hand the page's `document` these through
// helpers/page-vm.js's `documentExtras` and every element it builds with
// createElement, createElementNS or createDocumentFragment keeps its tag, its class
// name, its attributes, its dataset, its text and its children, so a test can walk what
// a render made. Anything an element is asked for that is not here answers like a
// harmless stand-in (page-vm.js), so the page runs on. Not a test file (the suite runs
// *.test.js only).
const { harmless } = require('./page-vm');

function recordingElement(tag) {
  const own = {
    tag,
    children: [],
    attrs: {},
    dataset: {},
    className: '',
    title: '',
    type: '',
    innerHTML: '',
    parent: null,
    listeners: {},
    addEventListener(type, fn) { (own.listeners[type] = own.listeners[type] || []).push(fn); },
    fire(type, event = {}) { (own.listeners[type] || []).slice().forEach((fn) => fn(event)); },
    appendChild(c) { c.parent = own; own.children.push(c); return c; },
    append(...list) { for (const c of list) { if (typeof c === 'string') own.children.push(recordingText(c)); else own.appendChild(c); } },
    setAttribute(k, v) { own.attrs[k] = String(v); if (k === 'class') own.className = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(own.attrs, k) ? own.attrs[k] : null; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(own.attrs, k); },
    get classes() { return own.className.split(/\s+/).filter(Boolean); },
    classList: new Proxy({
      add: (c) => { if (!own.classes.includes(c)) own.className = own.classes.concat(c).join(' '); },
      remove: (c) => { own.className = own.classes.filter((x) => x !== c).join(' '); },
      contains: (c) => own.classes.includes(c),
      toggle: (c, force) => {
        const on = force === undefined ? !own.classes.includes(c) : !!force;
        if (on) own.classList.add(c); else own.classList.remove(c);
        return on;
      },
    }, { get: (list, k) => (typeof k === 'string' && /^\d+$/.test(k) ? own.classes[Number(k)] : list[k]) }),
    // The element and its descendants, in document order.
    walk() { return [own].concat(...own.children.map((c) => (c.walk ? c.walk() : []))); },
    // The first ancestor (or itself) that has the attribute named by a `[data-x]` selector.
    closest(sel) {
      const m = /^\[data-([a-z-]+)\]$/.exec(sel);
      if (!m) return null;
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      for (let e = own; e; e = e.parent) if (e.dataset && e.dataset[key] !== undefined) return e;
      return null;
    },
  };
  let text = '';
  Object.defineProperty(own, 'textContent', {
    get: () => text,
    set: (value) => { text = String(value); own.children.length = 0; },
  });
  return new Proxy(own, {
    get: (target, key) => (key in target ? target[key] : harmless(`element.${String(key)}`)),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

function recordingText(text) {
  return { tag: '#text', textContent: String(text), children: [], walk() { return [this]; } };
}

function recordingDocument() {
  return {
    createElement: recordingElement,
    createElementNS: (ns, tag) => recordingElement(tag),
    createDocumentFragment: () => recordingElement('#fragment'),
  };
}

// Every element under `root` (itself included) that has the class.
const byClass = (root, cls) => root.walk().filter((e) => e.classes && e.classes.includes(cls));

module.exports = { recordingDocument, recordingElement, byClass };
