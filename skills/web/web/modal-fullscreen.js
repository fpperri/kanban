'use strict';
// Pure helpers for per-modal-type fullscreen state. No DOM/localStorage
// access here on purpose — same dual-environment pattern as column-state.js /
// column-sort.js / search.js: unit-testable from node --test AND loaded as a
// plain <script> in the browser (app.js calls these as bare globals).
//
// localStorage discipline: reuses column-state.js's storageKey() scheme
// (`kanban.<projectName>.<feature>`), under the feature name 'modal.fullscreen'
// — a sibling key to 'columns.collapsed' and 'columns.sort', never
// colliding since each feature gets its own key. One saved object covers every
// popup or panel (edit, detail, the bulk popups, the notes palette — a new
// type adds itself to MODAL_TYPES/DEFAULT_FULLSCREEN below and gets the same
// persistence for free, plus an entry in app.js's FULLSCREEN_MODALS).

const MODAL_TYPES = ['edit', 'detail', 'bulkSingle', 'bulkTags', 'bulkSchedule', 'notes'];
const DEFAULT_FULLSCREEN = { edit: false, detail: false, bulkSingle: false, bulkTags: false, bulkSchedule: false, notes: false };

// Merge a value decoded from localStorage (which may be missing, null, not an
// object, or carry a stale/unknown modal-type key) with the defaults — same
// defensive shape as column-state.js's mergeCollapsedState: unknown keys are
// dropped, missing keys fall back to the default, only real booleans are trusted.
function mergeFullscreenState(saved) {
  const result = Object.assign({}, DEFAULT_FULLSCREEN);
  if (saved && typeof saved === 'object') {
    for (const type of MODAL_TYPES) {
      if (typeof saved[type] === 'boolean') result[type] = saved[type];
    }
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MODAL_TYPES, DEFAULT_FULLSCREEN, mergeFullscreenState };
} else {
  window.MODAL_TYPES = MODAL_TYPES;
  window.DEFAULT_FULLSCREEN = DEFAULT_FULLSCREEN;
  window.mergeFullscreenState = mergeFullscreenState;
}
