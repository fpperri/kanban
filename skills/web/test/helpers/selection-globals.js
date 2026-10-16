'use strict';
// What a test sandbox needs to run the page's setSelection: the selection module's
// functions as globals, plus what the page hands them: the matcher a query part
// resolves through (selectionMatchIds, the search module's matcher except for the
// Graph's box text), the ids the view shows, and the step a repaint takes the text
// of a write to the box through (selectionFollowingBox). Here nothing matches a
// query, the view shows everything and the box was not written, so a selection of
// card parts resolves to those cards, and isolate is off (isolateNow, isolateTurnOff). Not a
// test file (the suite runs *.test.js only).
const selection = require('../../web/selection');
const { searchRemoveAlt, searchRemoveGrownAlt } = require('../../web/search');

// A selection of exactly these cards: the first is the anchor, the rest are additions.
const cardsSelection = (ids) => ids.reduce((next, id) => selection.addPart(next, selection.cardPart(id)), selection.NO_SELECTION);

function selectionGlobals(extra = {}) {
  return { ...selection, cardsSelection, searchMatchIds: () => new Set(), selectionMatchIds: () => new Set(), shownCardIds: () => null, selectionFollowingBox: (selection) => selection, isolateNow: () => null, isolateTurnOff: () => false, searchRemoveAlt, searchRemoveGrownAlt, ...extra };
}

module.exports = { cardsSelection, selectionGlobals };
