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
// The ask holds the keyboard while it is up: Tab and Shift+Tab cycle its own three buttons, and a key but
// Esc, Enter, Space and Tab goes no further than the window, so the chords the page behind answers (Ctrl+S
// saves the edit form, Alt+Enter makes it full screen) do nothing, the browser's save-page included.
// A click on the backdrop in the first DOUBLE_CLICK_MS after the ask opened is ignored: the second click
// of a double click or a double tap on the button that raised it lands there, and is no answer.
//
// askSegments is pure; the rest reads the page's $ at the moment it runs. Same dual-environment export
// pattern as more-menu.js.

const askState = { resolve: null, opener: null, openedAt: 0 };
const ASK_BUTTONS = ['#ask-close', '#ask-no', '#ask-yes']; // in the order the page draws them

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
    askState.openedAt = performance.now();
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
  if (!askState.resolve) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) askAnswer(false); // a held Esc is one press: the repeats of the one that opened the ask answer nothing
  } else if (e.key === 'Tab') askCycleFocus(e);
  else if ((e.key === 'Enter' || e.key === ' ') && !(e.ctrlKey || e.metaKey || e.altKey)) return; // the focused button's own
  else askKeepKey(e);
}

// Tab moves the focus along the ask's buttons, round the ring; a focus that got away is brought back to the first (the last with Shift).
function askCycleFocus(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  const buttons = ASK_BUTTONS.map((sel) => $(sel));
  const at = buttons.indexOf(document.activeElement);
  const last = buttons.length - 1;
  const next = at === -1 ? (e.shiftKey ? last : 0) : (at + (e.shiftKey ? last : 1)) % buttons.length;
  buttons[next].focus();
}

// The page behind does not hear the key. The chords it claims are cancelled too, or the browser would answer them (Ctrl+S opens its save-page).
function askKeepKey(e) {
  e.stopImmediatePropagation();
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (((e.ctrlKey || e.metaKey) && key === 's') || (e.altKey && e.key === 'Enter')) e.preventDefault();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { askSegments };
} else {
  window.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('keydown', askOnKey, true); // key-guard: exempt (acts only while the ask is open, and then owns Esc)
    $('#ask-yes').addEventListener('click', () => askAnswer(true));
    $('#ask-no').addEventListener('click', () => askAnswer(false));
    $('#ask-close').addEventListener('click', () => askAnswer(false));
    $('#ask').addEventListener('click', (e) => { if (e.target.id === 'ask' && performance.now() - askState.openedAt >= DOUBLE_CLICK_MS) askAnswer(false); });
  });
}
