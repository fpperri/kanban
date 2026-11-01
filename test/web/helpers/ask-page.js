'use strict';
// The in-page ask (ask-ui.js) for a test that runs the real page in a vm (helpers/page-vm.js): the five
// elements the ask draws into, as stand-ins a test can read and press, and a driver that works them the
// way a person does. `elements` goes into loadPage's `elements` option. Not a test file (the suite runs
// *.test.js only).
const { control } = require('./page-vm');

const ASK_IDS = ['ask', 'ask-text', 'ask-yes', 'ask-no', 'ask-close'];

function askElements() {
  const elements = {};
  for (const id of ASK_IDS) elements[`#${id}`] = control();
  elements['#ask'].classList.add('hidden');
  return elements;
}

function askDriver(page, elements) {
  const el = (id) => elements[`#${id}`];
  const settle = () => page.settle();
  // A key as the browser dispatches it: the window's listeners first, and the document's only when none of
  // them stopped it.
  const key = (name, extra = {}) => {
    const e = {
      key: name, repeat: false, defaultPrevented: false, stopped: false, ...extra,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const fn of (page.windowListeners.keydown || []).slice()) {
      if (e.stopped) break;
      fn(e);
    }
    if (!e.stopped) page.fireDocument('keydown', e);
    return e;
  };
  return {
    open: () => !el('ask').classList.contains('hidden'),
    text: () => el('ask-text').textContent,
    yesLabel: () => el('ask-yes').textContent,
    yes: async () => { el('ask-yes').fire('click', {}); await settle(); },
    no: async () => { el('ask-no').fire('click', {}); await settle(); },
    close: async () => { el('ask-close').fire('click', {}); await settle(); },
    backdrop: async () => { el('ask').fire('click', { target: { id: 'ask' } }); await settle(); },
    press: async (name, extra) => { const e = key(name, extra); await settle(); return e; },
    esc: async (extra) => { const e = key('Escape', extra); await settle(); return e; },
  };
}

// For a test that runs a few of the page's functions in a sandbox rather than the whole page: askInPage
// stands in for the ask (its DOM is ask-ui.test.js's to prove), writes each message it is given to
// calls.asks and answers at once, yes unless the test says otherwise.
function installAsk(sandbox, calls, answer = true) {
  calls.asks = [];
  sandbox.askInPage = async (message) => { calls.asks.push(message); return answer; };
}

module.exports = { askElements, askDriver, installAsk, ASK_IDS };
