const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { miniDocument } = require('./helpers/mini-dom');

// code-blocks.js is the loader for the two libraries, shared by the page and the snapshot: highlight.js
// colours a typed block whose language it knows, and a ```mermaid block is drawn by a sandboxed frame.
// Each brings its own addresses (the page its vendored files, the snapshot cdnjs and a srcdoc frame), which
// is the config handed to createCodeBlocks. It runs here in a vm against a small DOM, with the libraries and
// the frame played by hand, so what is asserted is when a file is asked for, what is asked of it, and what
// the block turns into.

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'code-blocks.js'), 'utf8').replace(/\r\n/g, '\n');
const codeLibs = require('../../plugin/skills/web/web/code-libs');

const WEB_CONFIG = {
  highlight: { src: '/vendor/highlight.js/highlight.min.js' },
  sheets: { light: { href: '/vendor/highlight.js/github.min.css' }, dark: { href: '/vendor/highlight.js/github-dark.min.css' } },
  frame: { src: '/mermaid-frame.html' },
};

function page({ dark = false, config = WEB_CONFIG } = {}) {
  const document = miniDocument();
  const windowListeners = {};
  const timers = [];
  const media = { matches: dark, listeners: [], addEventListener: (type, fn) => media.listeners.push(fn) };
  const watchers = [];
  const layoutWatchers = [];
  const highlighted = [];
  const sandbox = {
    document,
    kanbanCodeLibs: codeLibs,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    MutationObserver: class { constructor(fn) { watchers.push(fn); } observe() {} },
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; this.targets = []; layoutWatchers.push(this); }
      observe(el) { this.targets.push(el); }
      disconnect() { this.targets = []; }
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); };
  sandbox.matchMedia = () => media;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const codeBlocks = sandbox.kanbanCodeBlocks.createCodeBlocks({ libs: codeLibs, ...config });

  const root = document.body.appendChild(document.createElement('div'));
  const block = (lang, code = 'x') => {
    const box = document.createElement('div');
    box.className = 'md-code';
    const pre = document.createElement('pre');
    pre.setAttribute('data-lang', lang);
    const codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    box.appendChild(pre);
    root.appendChild(box);
    return { box, pre, code: codeEl };
  };
  const scripts = () => document.head.children.filter((n) => n.tag === 'script');
  const links = () => document.head.children.filter((n) => n.tag === 'link');
  const frames = () => root.walk().filter((n) => n.tag === 'iframe');
  const hljs = { highlightElement: (el) => { highlighted.push(el); el.className += ' hljs'; } };
  return {
    document, root, block, scripts, links, frames, highlighted, timers, media, hljs, windowListeners,
    enhance: () => codeBlocks.enhance(root),
    enhanceIn: (el) => codeBlocks.enhance(el),
    // The browser tells each observer its element may have a box now.
    layout() { for (const w of layoutWatchers.slice()) if (w.targets.length) w.fn(); },
    watching: () => layoutWatchers.filter((w) => w.targets.length).length,
    loadHighlight() { sandbox.hljs = hljs; scripts()[0].onload(); },
    message(frame, data, source) { for (const fn of windowListeners.message || []) fn({ source: source === undefined ? frame.contentWindow : source, data }); },
    retheme(theme) { if (theme === null) document.documentElement.attrs = {}; else document.documentElement.setAttribute('data-theme', theme); watchers.forEach((fn) => fn()); },
    settle: () => new Promise((r) => setImmediate(r)),
  };
}

// --- nothing is asked for unless a block needs it -----------------------------------------------------

test('a body with no typed block asks for no file and makes no frame', () => {
  const p = page();
  p.enhance();
  assert.strictEqual(p.scripts().length + p.links().length + p.frames().length, 0);
});

test('untyped, unknown-language and plain-text blocks ask for nothing either', () => {
  const p = page();
  p.block('klingon');
  p.block('text');
  p.block('powershell');
  p.enhance();
  assert.strictEqual(p.scripts().length + p.links().length + p.frames().length, 0);
});

test('a body with only highlightable code never makes a frame, and one with only a diagram never loads highlight.js', () => {
  const code = page();
  code.block('ts');
  code.enhance();
  assert.strictEqual(code.frames().length, 0);
  const diagram = page();
  diagram.block('mermaid');
  diagram.enhance();
  assert.strictEqual(diagram.scripts().length + diagram.links().length, 0);
  assert.strictEqual(diagram.frames().length, 1);
});

// --- highlight.js ---------------------------------------------------------------------------------------

test('a typed block in a known language loads highlight.js and its themes from the plugin, once for any number of blocks', () => {
  const p = page();
  p.block('c#');
  p.block('ts');
  p.block('json');
  p.enhance();
  assert.deepStrictEqual(p.scripts().map((s) => s.src), ['/vendor/highlight.js/highlight.min.js']);
  assert.deepStrictEqual(p.links().map((l) => [l.rel, l.href]), [['stylesheet', '/vendor/highlight.js/github.min.css'], ['stylesheet', '/vendor/highlight.js/github-dark.min.css']]);
  assert.ok(p.scripts().concat(p.links()).every((n) => !/^(https?:)?\/\//.test(n.src || n.href)), 'nothing comes from the network');
});

test('once highlight.js is there each block is coloured under highlight.js\'s own name for its language', async () => {
  const p = page();
  const a = p.block('c#');
  const b = p.block('TS');
  p.block('klingon');
  p.enhance();
  p.loadHighlight();
  await p.settle();
  assert.deepStrictEqual(p.highlighted, [a.code, b.code]);
  assert.strictEqual(a.code.className.split(' ')[0], 'language-csharp');
  assert.strictEqual(b.code.className.split(' ')[0], 'language-typescript');
});

test('the label and the Copy button stay, and the text copied is the code', async () => {
  const p = page();
  const a = p.block('ts', 'let x = 1;');
  p.enhance();
  p.loadHighlight();
  await p.settle();
  assert.strictEqual(a.box.classList.contains('md-code'), true);
  assert.strictEqual(a.pre.getAttribute('data-lang'), 'ts');
  assert.strictEqual(a.code.textContent, 'let x = 1;');
});

test('a block is coloured once however often the body is looked at again', async () => {
  const p = page();
  p.block('ts');
  p.enhance();
  p.loadHighlight();
  await p.settle();
  p.enhance();
  await p.settle();
  assert.strictEqual(p.highlighted.length, 1);
  assert.strictEqual(p.scripts().length, 1);
});

test('a second body asks for no second copy of the library', async () => {
  const p = page();
  p.block('ts');
  p.enhance();
  p.loadHighlight();
  await p.settle();
  p.block('python');
  p.enhance();
  await p.settle();
  assert.strictEqual(p.scripts().length, 1);
  assert.strictEqual(p.highlighted.length, 2);
});

test('when highlight.js cannot be loaded the block stays plain and the body is none the worse', async () => {
  const p = page();
  const a = p.block('ts', 'let x = 1;');
  p.enhance();
  p.scripts()[0].onerror();
  await p.settle();
  assert.strictEqual(p.highlighted.length, 0);
  assert.strictEqual(a.code.textContent, 'let x = 1;');
});

test('a body drawn again before the library arrives is not coloured when its block is gone', async () => {
  const p = page();
  const a = p.block('ts');
  p.enhance();
  a.box.remove();
  p.loadHighlight();
  await p.settle();
  assert.strictEqual(p.highlighted.length, 0);
});

test('the light theme is on in a light page and the dark one in a dark page, and the page swaps them as it changes', () => {
  const light = page();
  light.block('ts');
  light.enhance();
  assert.deepStrictEqual(light.links().map((l) => l.disabled), [false, true]);
  light.retheme('dark');
  assert.deepStrictEqual(light.links().map((l) => l.disabled), [true, false]);
  light.retheme('light');
  assert.deepStrictEqual(light.links().map((l) => l.disabled), [false, true]);

  const dark = page({ dark: true });
  dark.block('ts');
  dark.enhance();
  assert.deepStrictEqual(dark.links().map((l) => l.disabled), [true, false]);
  dark.retheme('light');
  assert.deepStrictEqual(dark.links().map((l) => l.disabled), [false, true], 'an explicit choice beats the system\'s');
});

test('the system theme changing swaps them too', () => {
  const p = page();
  p.block('ts');
  p.enhance();
  p.media.matches = true;
  p.media.listeners.forEach((fn) => fn());
  assert.deepStrictEqual(p.links().map((l) => l.disabled), [true, false]);
});

// --- mermaid ---------------------------------------------------------------------------------------------

test('a mermaid block makes a sandboxed frame for the diagram, beside the block, with no more allowed than scripts', () => {
  const p = page();
  const m = p.block('mermaid', 'graph TD; A-->B;');
  p.enhance();
  const [frame] = p.frames();
  assert.strictEqual(frame.getAttribute('sandbox'), 'allow-scripts', 'scripts only: no same-origin, no forms, no top navigation');
  assert.strictEqual(frame.src, '/mermaid-frame.html');
  assert.strictEqual(frame.parentNode, m.box.parentNode);
  assert.strictEqual(m.box.nextSibling, frame);
  assert.strictEqual(frame.classList.contains('md-diagram-pending'), true, 'the frame is out of sight until the diagram is drawn, but laid out, so mermaid can measure');
  assert.strictEqual(frame.hidden, false);
  assert.strictEqual(m.box.hidden, false, 'and the block stays until then');
});

test('the frame is asked to draw once it says it is ready, with the block\'s text and the page\'s theme', () => {
  const p = page();
  p.block('mermaid', 'graph TD; A-->B;');
  p.enhance();
  const [frame] = p.frames();
  assert.deepStrictEqual(frame.contentWindow.posted, [], 'nothing is sent before it is ready');
  p.message(frame, { type: 'ready' });
  assert.strictEqual(frame.contentWindow.posted.length, 1);
  const [message, target] = frame.contentWindow.posted[0];
  assert.deepStrictEqual({ ...message }, { type: 'render', id: message.id, source: 'graph TD; A-->B;', theme: 'light' });
  assert.strictEqual(typeof message.id, 'number');
  assert.strictEqual(target, '*', 'an opaque origin can only be addressed as *');
});

test('a diagram that is drawn replaces the block, at the height the frame reports', () => {
  const p = page();
  const m = p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  const { id } = frame.contentWindow.posted[0][0];
  p.message(frame, { type: 'rendered', id, height: 240 });
  assert.strictEqual(frame.classList.contains('md-diagram-pending'), false);
  assert.strictEqual(frame.style.height, '240px');
  assert.strictEqual(m.box.hidden, true);
  p.message(frame, { type: 'size', id, height: 310 });
  assert.strictEqual(frame.style.height, '310px');
});

test('a diagram that does not parse leaves the labelled block with a one-line error under it, and the rest of the body alone', () => {
  const p = page();
  const m = p.block('mermaid', 'not a diagram');
  const other = p.block('ts');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  const { id } = frame.contentWindow.posted[0][0];
  p.message(frame, { type: 'error', id, message: 'Parse error on line 1' });
  assert.strictEqual(m.box.hidden, false, 'the block is still there');
  assert.strictEqual(frame.parentNode, null, 'and the frame is gone');
  const note = m.box.nextSibling;
  assert.strictEqual(note.className, 'md-diagram-error');
  assert.strictEqual(note.getAttribute('role'), 'alert');
  assert.strictEqual(note.textContent, 'Diagram error: Parse error on line 1');
  assert.strictEqual(other.box.parentNode, p.root, 'the other block is untouched');
});

test('a frame that never answers is given up on, with the same error', () => {
  const p = page();
  const m = p.block('mermaid');
  p.enhance();
  const wait = p.timers.find((t) => t.live);
  assert.ok(wait && wait.ms >= 5000, 'a wait of some seconds is set');
  wait.fn();
  assert.strictEqual(p.frames().length, 0);
  assert.match(m.box.nextSibling.textContent, /^Diagram error: /);
  assert.strictEqual(m.box.hidden, false);
});

test('the answer of a frame that is drawn stops its wait', () => {
  const p = page();
  p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  p.message(frame, { type: 'rendered', id: frame.contentWindow.posted[0][0].id, height: 10 });
  assert.ok(p.timers.every((t) => !t.live));
});

test('a message from anything but a frame the page made is ignored', () => {
  const p = page();
  const m = p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  const { id } = frame.contentWindow.posted[0][0];
  p.message(frame, { type: 'rendered', id, height: 99 }, { someOther: 'window' });
  p.message(frame, { type: 'rendered', id, height: 99 }, null);
  p.message(frame, { type: 'error', id, message: 'forged' }, { other: true });
  assert.strictEqual(frame.classList.contains('md-diagram-pending'), true);
  assert.strictEqual(m.box.hidden, false);
  assert.strictEqual(m.box.nextSibling, frame);
});

test('a malformed message from the frame itself does nothing', () => {
  const p = page();
  const m = p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  for (const data of [null, undefined, 'text', 4, {}, { type: 'rendered' }, { type: 'rendered', id: 'x', height: 'tall' }, { type: 'nonsense', id: 1 }]) p.message(frame, data);
  assert.strictEqual(frame.classList.contains('md-diagram-pending'), true);
  assert.strictEqual(m.box.hidden, false);
});

test('a drawn diagram is redrawn when the theme changes, and a dark page asks for the dark theme to start with', () => {
  const p = page({ dark: true });
  p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  assert.strictEqual(frame.contentWindow.posted[0][0].theme, 'dark');
  const { id } = frame.contentWindow.posted[0][0];
  p.message(frame, { type: 'rendered', id, height: 100 });
  p.retheme('light');
  assert.strictEqual(frame.contentWindow.posted.length, 2);
  assert.strictEqual(frame.contentWindow.posted[1][0].theme, 'light');
  assert.strictEqual(frame.contentWindow.posted[1][0].id, id);
  assert.strictEqual(frame.contentWindow.posted[1][0].source, 'x');
});

test('a diagram whose body has been replaced is not redrawn', () => {
  const p = page();
  const m = p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  p.message(frame, { type: 'ready' });
  p.message(frame, { type: 'rendered', id: frame.contentWindow.posted[0][0].id, height: 100 });
  m.box.remove();
  frame.remove();
  p.retheme('dark');
  assert.strictEqual(frame.contentWindow.posted.length, 1);
});

function diagramIn(p, wrap) {
  const box = p.document.createElement('div');
  box.className = 'md-code';
  const pre = p.document.createElement('pre');
  pre.setAttribute('data-lang', 'mermaid');
  pre.appendChild(p.document.createElement('code'));
  box.appendChild(pre);
  wrap.appendChild(box);
  return { box, pre };
}

test('a diagram in a closed section waits until the section is opened, since a frame with no layout cannot be measured', () => {
  const p = page();
  const details = p.document.createElement('details');
  details.append(p.document.createElement('summary'));
  p.root.appendChild(details);
  diagramIn(p, details);
  p.enhance();
  assert.strictEqual(p.frames().length, 0, 'closed: no frame yet');
  assert.strictEqual(p.watching(), 1, 'but the block is watched for a box');
  p.layout();
  assert.strictEqual(p.frames().length, 0, 'a change that gives it no box does nothing');
  details.setAttribute('open', '');
  p.layout();
  assert.strictEqual(p.frames().length, 1, 'opened: the frame is made');
  assert.strictEqual(p.watching(), 0, 'and the watch is over');
  p.layout();
  assert.strictEqual(p.frames().length, 1, 'once');
});

// The detail popup writes a card's body and only then takes .hidden off the modal, so the body is
// drawn while nothing in it has a box.
test('a diagram written into a popup that is still hidden is drawn when the popup is shown', () => {
  const p = page();
  const modal = p.document.createElement('div');
  modal.className = 'modal hidden';
  p.root.appendChild(modal);
  const body = p.document.createElement('div');
  modal.appendChild(body);
  diagramIn(p, body);
  p.enhanceIn(body);
  assert.strictEqual(p.frames().length, 0, 'no box yet: nothing is made');
  modal.classList.remove('hidden');
  p.layout();
  assert.strictEqual(p.frames().length, 1, 'shown: the frame is made without anything else happening');
});

test('a body drawn again before the popup is shown is not drawn twice', () => {
  const p = page();
  const modal = p.document.createElement('div');
  modal.className = 'hidden';
  p.root.appendChild(modal);
  diagramIn(p, modal);
  p.enhanceIn(modal);
  p.enhanceIn(modal);
  modal.classList.remove('hidden');
  p.layout();
  assert.strictEqual(p.frames().length, 1);
});

test('a block removed while it waited for a box is not drawn', () => {
  const p = page();
  const modal = p.document.createElement('div');
  modal.className = 'hidden';
  p.root.appendChild(modal);
  const { box } = diagramIn(p, modal);
  p.enhanceIn(modal);
  box.remove();
  modal.classList.remove('hidden');
  p.layout();
  assert.strictEqual(p.frames().length, 0);
});

// --- what the page and the snapshot each hand in ------------------------------------------------------------------

test('an integrity hash and crossorigin go on the library\'s script and its theme links when the config has them', () => {
  const p = page({
    config: {
      highlight: { src: 'https://cdn.test/h.js', integrity: 'sha384-AAA' },
      sheets: { light: { href: 'https://cdn.test/l.css', integrity: 'sha384-BBB' }, dark: { href: 'https://cdn.test/d.css', integrity: 'sha384-CCC' } },
      frame: { src: '/f.html' },
    },
  });
  p.block('ts');
  p.enhance();
  const [script] = p.scripts();
  assert.deepStrictEqual([script.src, script.integrity, script.crossOrigin], ['https://cdn.test/h.js', 'sha384-AAA', 'anonymous']);
  assert.deepStrictEqual(p.links().map((l) => [l.href, l.integrity, l.crossOrigin]), [['https://cdn.test/l.css', 'sha384-BBB', 'anonymous'], ['https://cdn.test/d.css', 'sha384-CCC', 'anonymous']]);
});

test('with no integrity in the config none is set', () => {
  const p = page();
  p.block('ts');
  p.enhance();
  assert.strictEqual(p.scripts()[0].integrity, undefined);
  assert.strictEqual(p.scripts()[0].crossOrigin, undefined);
});

test('a config with a srcdoc makes the frame from that document, and never from an address', () => {
  const p = page({ config: { ...WEB_CONFIG, frame: { srcdoc: '<!doctype html><p>frame</p>' } } });
  p.block('mermaid');
  p.enhance();
  const [frame] = p.frames();
  assert.strictEqual(frame.srcdoc, '<!doctype html><p>frame</p>');
  assert.strictEqual(frame.src, undefined);
  assert.strictEqual(frame.getAttribute('sandbox'), 'allow-scripts');
});

test('the highlight load is held under a name that says what it is', () => {
  assert.match(src, /let highlightLoading = null;/);
});

test('the script names no address of its own: the config does', () => {
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /allow-same-origin/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|eval\(|new Function/);
});
