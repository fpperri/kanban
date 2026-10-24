'use strict';
// "Typing isolates": for each view, whether a query the person makes (typing, a pill, a cue on a card, a
// ?q= link) turns isolate on there. On in every view but the Graph to start with, so typing narrows the
// Board and lights in the Graph. The choice is one flag per view, kept per board in the browser under the
// feature key 'typing.isolates' (isolate.js), the way hover-show.js keeps On hover show: a value this
// version does not offer, or storage that refuses, reads as the default. The views are the page's own
// list (VIEW_MODES, calendar-model.js). Pure, no DOM, the dual-environment pattern of hover-show.js:
// loaded as a plain <script> in the browser, after calendar-model.js, and required directly by node --test.
const TI_VIEWS = (typeof module !== 'undefined' && module.exports) ? require('./calendar-model').VIEW_MODES : window.VIEW_MODES;

function typingIsolatesDefaults() {
  const defaults = {};
  for (const view of TI_VIEWS) defaults[view] = view !== 'graph';
  return defaults;
}

// What a browser stored for a board (the text, or the value parsed from it): a view with a true or false
// keeps it, and any other reads as the default.
function mergeTypingIsolates(saved) {
  let own = saved;
  if (typeof own === 'string') {
    try { own = JSON.parse(own); } catch (e) { own = null; }
  }
  const merged = typingIsolatesDefaults();
  if (own === null || typeof own !== 'object' || Array.isArray(own)) return merged;
  for (const view of TI_VIEWS) {
    if (Object.prototype.hasOwnProperty.call(own, view) && typeof own[view] === 'boolean') merged[view] = own[view];
  }
  return merged;
}

// The choice with one view's flag set; the argument is not touched, and a view or a value the panel
// cannot offer changes nothing.
function typingIsolatesWith(setting, view, on) {
  const next = mergeTypingIsolates(setting);
  if (TI_VIEWS.includes(view) && typeof on === 'boolean') next[view] = on;
  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { typingIsolatesDefaults, mergeTypingIsolates, typingIsolatesWith };
} else {
  window.typingIsolatesDefaults = typingIsolatesDefaults;
  window.mergeTypingIsolates = mergeTypingIsolates;
  window.typingIsolatesWith = typingIsolatesWith;
}
