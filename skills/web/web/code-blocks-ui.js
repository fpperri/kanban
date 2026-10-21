'use strict';
// Colour and diagrams for the typed code blocks markdown.js draws (docs/web.md, Markdown). A body is
// scanned after it is written (markdownInto calls enhanceCodeBlocks), and kanbanCodeLibs decides, from
// the languages the fences name, which library a block needs. Nothing is requested unless one does:
//
//   * highlight.js, for a language it knows (c# is csharp, ts is typescript, ...): its script and its
//     light and dark themes are read from web/vendor on the first such block, and the block is coloured
//     in place. The label and Copy stay, and the text copied is still the code.
//   * mermaid, for a ```mermaid block: the diagram is drawn in a sandboxed frame (mermaid-frame.html),
//     because mermaid writes inline styles that the page's CSP refuses and the page does not loosen it.
//     The frame is asked by postMessage and answers the same way; the block turns into the diagram when
//     it is drawn, and stays, with a one-line error under it, when it cannot be.
//
// Both follow the page's theme: an explicit data-theme on the root, else the system's, and they redraw
// when it changes. Reads kanbanCodeLibs (code-libs.js) at the moment it runs, never when it loads.

const codeBlocks = (() => {
  const URLS = {
    highlight: '/vendor/highlight.js/highlight.min.js',
    light: '/vendor/highlight.js/github.min.css',
    dark: '/vendor/highlight.js/github-dark.min.css',
    frame: '/mermaid-frame.html',
  };
  const FRAME_WAIT_MS = 20000;
  const MAX_HEIGHT = 6000;

  let loading = null;
  let watching = false;
  let listening = false;
  let diagramSeq = 0;
  const sheets = {};
  const diagrams = new Set();

  function themeName() {
    const chosen = document.documentElement.getAttribute('data-theme');
    if (chosen === 'dark' || chosen === 'light') return chosen;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // One stylesheet for each theme, only the page's own on.
  function paintSheets() {
    for (const mode of ['light', 'dark']) {
      if (!sheets[mode]) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = URLS[mode];
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
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = URLS.highlight;
        script.onload = () => resolve(window.hljs);
        script.onerror = () => reject(new Error('highlight.js did not load'));
        document.head.appendChild(script);
      });
      loading.catch(() => { loading = null; });
      paintSheets();
      watchTheme();
    }
    return loading;
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

  // Only a frame this page made is listened to, and only for the shapes it answers with.
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

  function diagram(block, root) {
    if (block.pre.hasAttribute('data-enhanced')) return;
    if (block.pre.getClientRects().length === 0) {
      // No layout yet (a closed section): mermaid could not measure it. Look again when a section opens.
      if (!root.hasAttribute('data-code-watch')) {
        root.setAttribute('data-code-watch', '1');
        root.addEventListener('toggle', () => enhance(root), true);
      }
      return;
    }
    block.pre.setAttribute('data-enhanced', '1');
    const box = block.pre.closest('.md-code') || block.pre;
    const frame = document.createElement('iframe');
    frame.className = 'md-diagram md-diagram-pending';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Diagram');
    frame.src = URLS.frame;
    box.parentNode.insertBefore(frame, box.nextSibling);
    const d = { id: ++diagramSeq, frame, box, source: block.code.textContent, state: 'pending', note: null, timer: null };
    d.timer = setTimeout(() => fail(d, 'the diagram frame did not answer'), FRAME_WAIT_MS);
    diagrams.add(d);
    if (!listening) { listening = true; window.addEventListener('message', onMessage); }
    watchTheme();
  }

  function enhance(root) {
    const blocks = [...root.querySelectorAll('pre[data-lang]')].map((pre) => ({ pre, code: pre.querySelector('code'), lang: pre.getAttribute('data-lang') }));
    kanbanCodeLibs.enhanceBlocks(blocks, { highlight, mermaid: (block) => diagram(block, root) });
  }

  return { enhance };
})();

function enhanceCodeBlocks(root) {
  codeBlocks.enhance(root);
}
