'use strict';
// Markdown on the page (markdown.js draws it as an HTML string; this is where it lands): the one
// place the renderer's output is written into an element, and the Copy button of a typed code
// block. Card bodies, the notes palette's notes and the scratchpad's preview all come through
// markdownInto, so a block behaves the same in each.
//
// Reads app.js's globals at the moment it runs, never when it loads: state, fallbackCopy.

// Draws text as Markdown into el. The renderer escapes every piece of text it writes, so this is
// the only innerHTML write a person's prose ever reaches.
function markdownInto(el, text) {
  el.innerHTML = mdToHtml(text || '', { board: state.projectName });
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
