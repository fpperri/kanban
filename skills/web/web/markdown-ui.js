'use strict';
// Markdown on the page (markdown.js draws it as an HTML string; this is where it lands): the one
// place the renderer's output is written into an element, and the Copy button of a typed code
// block. Card bodies and the scratchpad's preview come through markdownInto (the notes list will),
// so a block behaves the same in each.
//
// Reads app.js's globals at the moment it runs, never when it loads: state, fallbackCopy.

// Colour and diagrams for typed blocks (code-blocks.js), from the vendored libraries. The files are
// version-pinned, so the version rides the address and the server may cache them for good.
const codeBlocks = kanbanCodeBlocks.createCodeBlocks({
  libs: kanbanCodeLibs,
  highlight: { src: `/vendor/highlight.js/highlight.min.js?v=${kanbanCodeLibs.HIGHLIGHT_VERSION}` },
  sheets: {
    light: { href: `/vendor/highlight.js/github.min.css?v=${kanbanCodeLibs.HIGHLIGHT_VERSION}` },
    dark: { href: `/vendor/highlight.js/github-dark.min.css?v=${kanbanCodeLibs.HIGHLIGHT_VERSION}` },
  },
  frame: { src: '/mermaid-frame.html' },
});

// Draws text as Markdown into el. The renderer escapes every piece of text it writes, so this is
// the only innerHTML write a person's prose ever reaches. `opts.inline` draws one line with no block
// around it (a todo item's row).
function markdownInto(el, text, opts) {
  const board = { board: state.projectName };
  el.innerHTML = opts && opts.inline ? mdInlineToHtml(text || '', board) : mdToHtml(text || '', board);
  if (opts && opts.inline) return; // one line holds no typed block
  // Colour and diagrams for typed blocks: only ever an addition to the text just drawn, so
  // whatever goes wrong there leaves the plain body.
  try { codeBlocks.enhance(el); } catch (e) { console.error(e); }
}

// The Copy button of a typed code block: the block's text, never the label, through the same
// clipboard ladder as the path buttons.
function copyCodeBlock(btn) {
  const code = btn.closest('.md-code').querySelector('pre code');
  const text = code ? code.textContent : '';
  const show = (ok) => {
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    btn.classList.toggle('copy-success', ok);
    btn.classList.toggle('copy-failed', !ok);
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copy-success', 'copy-failed'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => show(true), () => show(fallbackCopy(text)));
  } else show(fallbackCopy(text));
}

// One delegated listener serves every Copy button, wherever the renderer put it.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.md-code-copy');
  if (btn) copyCodeBlock(btn);
});
