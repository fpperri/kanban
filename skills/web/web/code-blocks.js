'use strict';
// Colour and diagrams for the typed code blocks markdown.js draws (docs/web.md, Markdown), shared by
// the page and the snapshot. createCodeBlocks(config) returns { enhance(root), enhanceBlocks(blocks) };
// kanbanCodeLibs (code-libs.js) decides, from the languages the fences name, which library a block
// needs, and nothing is requested unless one does:
//
//   * highlight.js, for a language it knows (c# is csharp, ts is typescript, ...): its script and its
//     light and dark themes are loaded on the first such block, and the block is coloured in place.
//     The label and Copy stay, and the text copied is still the code.
//   * mermaid, for a ```mermaid block: the diagram is drawn in a sandboxed frame, because mermaid
//     writes inline styles that the page's CSP refuses and because it must never run in a page that
//     holds anything of the board's. The frame is asked by postMessage and answers the same way; the
//     block turns into the diagram when it is drawn, and stays, with a one-line error under it, when it
//     cannot be.
//
// Where the libraries come from is the config: { libs: kanbanCodeLibs,
//   highlight: { src, integrity? }, sheets: { light: { href, integrity? }, dark: { ... } },
//   frame: { src } | { srcdoc } }.
// The page hands in its vendored files and a frame served by the server; the snapshot hands in
// cdnjs addresses with their integrity hashes and a srcdoc. An integrity hash goes on the element with
// crossorigin. A diagram, or a block in a hidden popup or a closed section, is drawn when it has a box
// (mermaid measures what it draws), so a block without one is watched until it does.
//
// Both follow the page's theme: an explicit data-theme on the root, else the system's, and they redraw
// when it changes. Reads `document` and `window` at the moment it runs, never when it loads.

const codeBlocksModule = (() => {
  const FRAME_WAIT_MS = 20000;
  const MAX_HEIGHT = 6000;

  function createCodeBlocks(config) {
    const libs = config.libs;
    let highlightLoading = null;
    let watching = false;
    let listening = false;
    let diagramSeq = 0;
    const sheets = {};
    const diagrams = new Set();
    const waiting = new WeakSet();

    function themeName() {
      const chosen = document.documentElement.getAttribute('data-theme');
      if (chosen === 'dark' || chosen === 'light') return chosen;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function withIntegrity(el, spec) {
      if (spec.integrity) { el.integrity = spec.integrity; el.crossOrigin = 'anonymous'; }
    }

    // One stylesheet for each theme, only the page's own on.
    function paintSheets() {
      for (const mode of ['light', 'dark']) {
        if (!sheets[mode]) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = config.sheets[mode].href;
          withIntegrity(link, config.sheets[mode]);
          document.head.appendChild(link);
          sheets[mode] = link;
        }
        sheets[mode].disabled = mode !== themeName();
      }
    }

    function post(d) {
      d.frame.contentWindow.postMessage({ type: 'render', id: d.id, source: d.source, theme: themeName() }, '*');
    }

    function onTheme() {
      if (sheets.light) paintSheets();
      for (const d of [...diagrams]) {
        if (!d.frame.isConnected) diagrams.delete(d);
        else if (d.state === 'drawn') post(d);
      }
    }

    function watchTheme() {
      if (watching) return;
      watching = true;
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
      new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    function ensureHighlight() {
      if (!highlightLoading) {
        highlightLoading = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = config.highlight.src;
          withIntegrity(script, config.highlight);
          script.onload = () => resolve(window.hljs);
          script.onerror = () => reject(new Error('highlight.js did not load'));
          document.head.appendChild(script);
        });
        highlightLoading.catch(() => { highlightLoading = null; });
        paintSheets();
        watchTheme();
      }
      return highlightLoading;
    }

    function highlight(block, language) {
      if (block.pre.hasAttribute('data-enhanced')) return;
      block.pre.setAttribute('data-enhanced', '1');
      ensureHighlight().then((hljs) => {
        if (!block.code.isConnected) return;
        block.code.className = `language-${language}`;
        hljs.highlightElement(block.code);
      }, () => {});
    }

    function fail(d, message) {
      clearTimeout(d.timer);
      diagrams.delete(d);
      d.frame.remove();
      d.box.hidden = false;
      if (d.note) d.note.remove();
      d.note = document.createElement('p');
      d.note.className = 'md-diagram-error';
      d.note.setAttribute('role', 'alert');
      d.note.textContent = `Diagram error: ${message}`;
      d.box.parentNode.insertBefore(d.note, d.box.nextSibling);
    }

    const heightOf = (m) => (Number.isFinite(m.height) ? Math.min(Math.max(0, m.height), MAX_HEIGHT) : null);

    // Only a frame this code made is listened to, and only for the shapes it answers with.
    function onMessage(e) {
      if (!e.source) return;
      const d = [...diagrams].find((x) => x.frame.contentWindow === e.source);
      const m = e.data;
      if (!d || !m || typeof m !== 'object') return;
      if (m.type === 'ready') { post(d); return; }
      if (m.id !== d.id) return;
      const height = heightOf(m);
      if ((m.type === 'rendered' || m.type === 'size') && height !== null) {
        if (m.type === 'rendered') {
          clearTimeout(d.timer);
          d.state = 'drawn';
          d.frame.classList.remove('md-diagram-pending');
          d.box.hidden = true;
          if (d.note) { d.note.remove(); d.note = null; }
        }
        d.frame.style.height = `${height}px`;
      } else if (m.type === 'error' && typeof m.message === 'string') fail(d, m.message);
    }

    // Runs fn once the block has a box, at once if it has one: a popup is written into before it is
    // shown and a closed section is not laid out, and the browser says when that changes.
    function whenLaidOut(block, fn) {
      if (block.pre.getClientRects().length > 0) { fn(); return; }
      if (waiting.has(block.pre)) return;
      waiting.add(block.pre);
      const watcher = new ResizeObserver(() => {
        if (!block.pre.isConnected) { watcher.disconnect(); return; }
        if (block.pre.getClientRects().length === 0) return;
        watcher.disconnect();
        fn();
      });
      watcher.observe(block.pre);
    }

    function diagram(block) {
      if (block.pre.hasAttribute('data-enhanced')) return;
      whenLaidOut(block, () => {
        if (block.pre.hasAttribute('data-enhanced')) return;
        block.pre.setAttribute('data-enhanced', '1');
        const box = block.pre.closest('.md-code') || block.pre;
        const frame = document.createElement('iframe');
        frame.className = 'md-diagram md-diagram-pending';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'Diagram');
        if (config.frame.srcdoc !== undefined) frame.srcdoc = config.frame.srcdoc;
        else frame.src = config.frame.src;
        box.parentNode.insertBefore(frame, box.nextSibling);
        const d = { id: ++diagramSeq, frame, box, source: block.code.textContent, state: 'pending', note: null, timer: null };
        d.timer = setTimeout(() => fail(d, 'the diagram frame did not answer'), FRAME_WAIT_MS);
        diagrams.add(d);
        if (!listening) { listening = true; window.addEventListener('message', onMessage); }
        watchTheme();
      });
    }

    function enhanceBlocks(blocks) {
      libs.enhanceBlocks(blocks, { highlight, mermaid: diagram });
    }

    function enhance(root) {
      enhanceBlocks([...root.querySelectorAll('pre[data-lang]')].map((pre) => ({ pre, code: pre.querySelector('code'), lang: pre.getAttribute('data-lang') })));
    }

    return { enhance, enhanceBlocks };
  }

  return { createCodeBlocks };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = codeBlocksModule;
} else {
  window.kanbanCodeBlocks = codeBlocksModule;
}
