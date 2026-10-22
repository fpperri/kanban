'use strict';
// The scenarios the browser runner knows: every .js file in this folder but this one, in
// file-name order, so a new scenario is found by being added and nothing else lists it.
// A scenario is { name, board, alsoBoards?, timeoutMs?, run(page) } and its name is its
// file name. It starts from a cleared browser and its board's cards as they were, so the
// order does not matter and any one can be run alone with --only. A module that is not a
// scenario belongs in a subfolder (phone-steps/ holds the phone scenario's steps), not here.

const fs = require('fs');
const path = require('path');

module.exports = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .sort()
  .map((f) => require(path.join(__dirname, f)));
