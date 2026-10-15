'use strict';
// What a test sandbox needs to run the page's setSelection: the selection module's
// functions as globals, plus the two things the page hands them, the matcher a
// query part resolves through and the ids the view shows. Here nothing matches a
// query and the view shows everything, so a selection of card parts resolves to
// those cards. Not a test file (the suite runs *.test.js only).
const selection = require('../../web/selection');

// A selection of exactly these cards: the first is the anchor, the rest are additions.
const cardsSelection = (ids) => ids.reduce((next, id) => selection.addPart(next, selection.cardPart(id)), selection.NO_SELECTION);

function selectionGlobals(extra = {}) {
  return { ...selection, cardsSelection, searchMatchIds: () => new Set(), shownCardIds: () => null, ...extra };
}

module.exports = { cardsSelection, selectionGlobals };
