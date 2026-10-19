'use strict';
// A board's live cards by their whole id string, for the scenario tests: the scenarios
// name plain ids as numbers, the cards the server sends hold them as strings, so a lookup
// by either finds the card. Not a test file (the suite runs *.test.js only).

class IdMap extends Map {
  get(id) { return super.get(String(id)); }
  has(id) { return super.has(String(id)); }
}

const idMap = (cards) => new IdMap(cards.map((c) => [String(c.id), c]));

module.exports = { idMap };
