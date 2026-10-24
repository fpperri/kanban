'use strict';
// A small stand-in for the DOM, for a page script that builds elements: createElement
// answers elements with children, attributes, a dataset, classes, insertBefore, remove
// and closest (one class selector). A page script run in the vm (page-vm.js) builds its
// buttons on it, and a test reads them back. Not a test file (the suite runs *.test.js).

function fakeDom() {
  const create = (tag) => {
    const el = {
      tag, isFake: true, children: [], dataset: {}, attrs: {}, parent: null, title: '', type: '', className: '', text: '',
      classes() { return new Set(this.className.split(/\s+/).filter(Boolean)); },
      classList: {
        toggle(name, force) {
          const set = el.classes();
          const on = force === undefined ? !set.has(name) : !!force;
          if (on) set.add(name); else set.delete(name);
          el.className = [...set].join(' ');
          return on;
        },
        contains: (name) => el.classes().has(name),
      },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      append(...nodes) { for (const n of nodes) { n.parent = el; el.children.push(n); } },
      insertBefore(node, ref) {
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = el;
        const at = ref ? el.children.indexOf(ref) : el.children.length;
        el.children.splice(at, 0, node);
      },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null; },
      closest(sel) {
        const cls = sel.replace(/^\./, '');
        for (let n = el; n && n.isFake === true; n = n.parent) if (n.classes().has(cls)) return n;
        return null;
      },
    };
    Object.defineProperty(el, 'textContent', { configurable: true, get: () => el.text, set: (v) => { el.text = String(v); } });
    return el;
  };
  return { createElement: create };
}

module.exports = { fakeDom };
