'use strict';
// The speedbump's question, asked in the page. A host that sandboxes the page (an artifact viewer)
// answers the browser's confirm() with "no", so every speedbump that went through it did nothing there;
// askInPage(message, { yes, code }) draws the question in the page instead and returns a promise of true
// (yes) or false (no). The message is the call site's own text, set as text; `yes` names the red button
// for the act (default OK); `code` shows a span between backticks as code instead of the backticks.
//
// One ask at a time: a second ask while one is up answers no at once and leaves the first on show, so
// nothing stacks and nothing goes ahead by accident. Esc, Cancel, the close button and a click on the
// backdrop answer no; Cancel takes the focus, so Enter says no too. #ask is a .modal-backdrop, last in the
// page and above every other popup, so the poll pauses and the single-key shortcuts stand still behind it,
// as behind the others. Esc is caught first, at the window's capture phase, and goes no further, so the
// Esc chain behind the ask (the edit form's Discard unsaved changes among it) never runs a second time.
//
// askSegments is pure; the rest reads the page's $ at the moment it runs. Same dual-environment export
// pattern as more-menu.js.

const askState = { resolve: null, opener: null };

// The message split at its backtick pairs: { text, code } in order. A backtick that closes nothing stays
// in the text as typed.
function askSegments(message) {
  const text = String(message);
  const out = [];
  let from = 0;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    if (m.index > from) out.push({ text: text.slice(from, m.index), code: false });
    out.push({ text: m[1], code: true });
    from = m.index + m[0].length;
  }
  if (from < text.length) out.push({ text: text.slice(from), code: false });
  return out;
}

function askFill(message, code) {
  const box = $('#ask-text');
  if (!code) { box.textContent = message; return; }
  box.replaceChildren(...askSegments(message).map((part) => {
    if (!part.code) return document.createTextNode(part.text);
    const el = document.createElement('code');
    el.textContent = part.text;
    return el;
  }));
}

function askInPage(message, { yes = 'OK', code = false } = {}) {
  if (askState.resolve) return Promise.resolve(false);
  return new Promise((resolve) => {
    askState.resolve = resolve;
    askState.opener = document.activeElement;
    askFill(message, code);
    $('#ask-yes').textContent = yes;
    $('#ask').classList.remove('hidden');
    $('#ask-no').focus();
    scheduleBackSync(); // a Back answers the question no, so the page keeps an entry for it
  });
}

function askAnswer(answer) {
  const resolve = askState.resolve;
  if (!resolve) return;
  const opener = askState.opener;
  askState.resolve = null;
  askState.opener = null;
  $('#ask').classList.add('hidden');
  if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  resolve(answer);
}

function askOnKey(e) {
  if (e.key !== 'Escape' || !askState.resolve) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) askAnswer(false); // a held Esc is one press: the repeats of the one that opened the ask answer nothing
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { askSegments };
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('keydown', askOnKey, true); // key-guard: exempt (acts only while the ask is open, and then owns Esc)
    $('#ask-yes').addEventListener('click', () => askAnswer(true));
    $('#ask-no').addEventListener('click', () => askAnswer(false));
    $('#ask-close').addEventListener('click', () => askAnswer(false));
    $('#ask').addEventListener('click', (e) => { if (e.target.id === 'ask') askAnswer(false); });
  });
}
