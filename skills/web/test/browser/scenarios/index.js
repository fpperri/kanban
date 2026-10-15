'use strict';
// The scenarios the browser runner knows, in the order a plain run takes them.
// A scenario is { name, board, alsoBoards?, timeoutMs?, run(page) }; it starts
// from a cleared browser and its board's cards as they were, so the order does
// not matter and any one can be run alone with --only.

module.exports = [
  require('./search-box'),
  require('./graph'),
  require('./key-guard'),
  require('./card-click'),
  require('./preferences'),
  require('./smoke'),
];
