'use strict';
// A browser session history for the page loadPage (page-vm.js) runs: the
// address bar and the entries behind the Back and Forward buttons. The page's
// history.pushState and history.replaceState write it, back() and forward()
// step through it the way the browser's own arrows do (the address changes,
// then popstate reaches the page's listener), and `pushes` and `replaces` count
// what the page asked for, so a test can say that typing grew no history. Each entry keeps the state
// the page gave it (`history.state` reads the current entry's, and a popstate carries the entry landed
// on), and `session.states` lists them beside `session.entries`.
//
// The browser's own Back button is not history.back(): Chrome's history manipulation intervention
// skips, on the Back button, every entry of a document that added an entry without a user activation,
// and a back or forward consumes the activation. `session.startDocument()` after the page's setup
// turns that model on for the entries from the current one up, `session.activate()` is a tap or a key
// (it ends the skipping), pushState without an activation marks the document's entries to be skipped, and
// `session.uiBack()` is the Back button: it steps back over the entries marked. history.back() ignores
// the marks, as the browser's does. The model is Chromium's documentation
// (docs/history_manipulation_intervention.md), not a phone's. A Back from the document's first entry leaves
// the page: nothing reaches the page's listener, and `session.left` says it happened.
// Not a test file (the suite runs *.test.js only).
const { harmless } = require('./page-vm');

const searchOf = (url) => {
  const at = String(url).indexOf('?');
  return at < 0 ? '' : String(url).slice(at);
};

// A stand-in for an element the page wires a listener to, which a test then
// fires; anything else the page asks of it answers like a harmless element.
function listening(label) {
  const listeners = {};
  const own = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, event = {}) { (listeners[type] || []).slice().forEach((fn) => fn(event)); },
  };
  return new Proxy(own, {
    get: (target, key) => (key in target ? target[key] : harmless(`${label}.${String(key)}`)),
    set: () => true,
  });
}

// Call before page.start(): the page reads `history` and `location` at the time
// it uses them, and wires the detail popup's close button when it starts.
// A card's detail is answered by `detail(id)`; the popup's close button is
// session.close. session.popupOpen = true makes the page see another popup
// (the edit form, say) open over the board.
function attachSessionHistory(page, { detail = (id) => ({ id, title: `Card ${id}`, frontmatter: '', body: '', path: `/board/${id}.card.md`, archived: false }) } = {}) {
  const { ctx } = page;
  const entries = [ctx.location.search];
  const states = [null];
  const session = { entries, states, pushes: 0, replaces: 0, left: false, popupOpen: false, close: listening('detail-close') };
  let index = 0;
  const skipped = [false];
  let documentFrom = null;
  let activated = false;

  const move = (search) => {
    ctx.location.search = search;
    ctx.location.href = `http://localhost${ctx.location.pathname}${search}`;
  };
  const land = (to) => {
    index = to;
    activated = false;
    move(entries[index]);
    (page.windowListeners.popstate || []).slice().forEach((fn) => fn({ state: states[index] }));
  };

  ctx.history = {
    get state() { return states[index]; },
    get length() { return entries.length; },
    pushState(state, title, url) {
      entries.splice(index + 1);
      states.splice(index + 1);
      skipped.splice(index + 1);
      entries.push(searchOf(url));
      states.push(state === undefined ? null : state);
      skipped.push(false);
      index = entries.length - 1;
      if (documentFrom !== null && !activated) for (let i = documentFrom; i < skipped.length; i++) skipped[i] = true;
      session.pushes++;
      move(entries[index]);
    },
    replaceState(state, title, url) {
      entries[index] = searchOf(url);
      states[index] = state === undefined ? null : state;
      session.replaces++;
      move(entries[index]);
    },
    back() { if (index > 0) land(index - 1); else session.left = true; },
    forward() { if (index < entries.length - 1) land(index + 1); },
  };
  session.back = () => ctx.history.back();
  session.startDocument = () => { documentFrom = index; skipped.fill(false); };
  session.activate = () => { activated = true; skipped.fill(false); };
  session.uiBack = () => {
    let to = index - 1;
    while (to > 0 && skipped[to]) to--;
    if (index > 0) land(Math.max(to, 0));
    else session.left = true;
  };
  session.forward = () => ctx.history.forward();
  Object.defineProperty(session, 'index', { get: () => index });
  Object.defineProperty(session, 'skipped', { get: () => skipped.slice() });
  Object.defineProperty(session, 'search', { get: () => entries[index] });

  const realFetch = ctx.fetch;
  ctx.fetch = async (url, init) => {
    const m = /^\/api\/cards\/(\d+)\/detail$/.exec(String(url));
    if (!m) return realFetch(url, init);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(detail(Number(m[1]))) };
  };

  const realQuery = ctx.document.querySelector;
  ctx.document.querySelector = (sel) => {
    if (sel === '#detail-close') return session.close;
    if (session.popupOpen && sel === '.modal-backdrop:not(#detail-modal):not(.hidden)') return {};
    return realQuery(sel);
  };
  return session;
}

module.exports = { attachSessionHistory };
