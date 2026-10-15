'use strict';
// The scenarios the browser runner knows, in the order a plain run takes them.
// A scenario is { name, board, alsoBoards?, timeoutMs?, run(page) }; it starts
// from a cleared browser and its board's cards as they were, so the order does
// not matter and any one can be run alone with --only.

module.exports = [
  require('./search-box'),
  require('./search-address'),
  require('./search-grammar'),
  require('./graph'),
  require('./key-guard'),
  require('./card-click'),
  require('./selection'),
  require('./config-keys'),
  require('./smoke'),
  require('./calendar-jump'),
  require('./card-menu'),
];
