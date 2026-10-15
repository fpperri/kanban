'use strict';
// A browser session history for the page loadPage (page-vm.js) runs: the
// address bar and the entries behind the Back and Forward buttons. The page's
// history.pushState and history.replaceState write it, back() and forward()
// step through it the way the browser's own arrows do (the address changes,
// then popstate reaches the page's listener), and `pushes` and `replaces` count
// what the page asked for, so a test can say that typing grew no history.
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
  const session = { entries, pushes: 0, replaces: 0, popupOpen: false, close: listening('detail-close') };
  let index = 0;

  const move = (search) => {
    ctx.location.search = search;
    ctx.location.href = `http://localhost${ctx.location.pathname}${search}`;
  };
  const land = (to) => {
    index = to;
    move(entries[index]);
    (page.windowListeners.popstate || []).slice().forEach((fn) => fn({}));
  };

  ctx.history = {
    state: null,
    get length() { return entries.length; },
    pushState(state, title, url) {
      entries.splice(index + 1);
      entries.push(searchOf(url));
      index = entries.length - 1;
      session.pushes++;
      move(entries[index]);
    },
    replaceState(state, title, url) {
      entries[index] = searchOf(url);
      session.replaces++;
      move(entries[index]);
    },
    back() { if (index > 0) land(index - 1); },
    forward() { if (index < entries.length - 1) land(index + 1); },
  };
  Object.defineProperty(session, 'index', { get: () => index });
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
