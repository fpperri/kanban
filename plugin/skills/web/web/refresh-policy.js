'use strict';
// Pure predicate for the auto-refresh poller: whether a tick should be skipped.
// No DOM access here on purpose — this file is loaded as a plain <script> in the
// browser (app.js calls shouldSkipAutoRefresh as a bare global) AND required
// directly by node --test, without needing a DOM/jsdom shim.
function shouldSkipAutoRefresh({ modalOpen, dragging, hidden, boardControlFocused }) {
  return !!(modalOpen || dragging || hidden || boardControlFocused);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shouldSkipAutoRefresh };
} else {
  window.shouldSkipAutoRefresh = shouldSkipAutoRefresh;
}
