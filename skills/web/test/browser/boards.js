'use strict';
// The boards the browser runner drives. Each is a stack of fixture folders
// copied over one another in order, so the plan board is today's fixture board
// with a hierarchy laid over it: a file in a later folder with the same name
// replaces the earlier one, a new name adds a card.
//
//   fixture    no hierarchy, no pills, no icons (the Graph scenario's board)
//   plan       the fixture board plus a hierarchy, typed cards with icons, pills
//   malformed  broken hierarchy, pill and icon entries, to prove a view never breaks
//
// skills/web/test/browser-fixtures.test.js pins what is on each board.

const fs = require('fs');
const path = require('path');

const BOARDS = {
  fixture: { name: 'fixture', layers: ['fixture'] },
  plan: { name: 'plan', layers: ['fixture', 'fixture-plan'] },
  malformed: { name: 'malformed', layers: ['fixture-malformed'] },
};

// Writes board `key` into `dest`, which is emptied first, so calling it again
// puts a board back as it was. `port` pins the serving port the way a human
// would, as the first line of the config.
function materialize(key, dest, { port } = {}) {
  const board = BOARDS[key];
  if (!board) throw new Error(`unknown board '${key}': ${Object.keys(BOARDS).join(', ')}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const layer of board.layers) fs.cpSync(path.join(__dirname, layer), dest, { recursive: true, force: true });
  if (port) {
    const cfg = path.join(dest, 'config.yaml');
    fs.writeFileSync(cfg, `port: ${port}\n${fs.readFileSync(cfg, 'utf8')}`);
  }
  return dest;
}

module.exports = { BOARDS, materialize };
