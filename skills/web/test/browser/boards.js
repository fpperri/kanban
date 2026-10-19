'use strict';
// The boards the browser runner drives. Each is a stack of fixture folders
// copied over one another in order, so the plan board is today's fixture board
// with a hierarchy laid over it: a file in a later folder with the same name
// replaces the earlier one, a new name adds a card.
//
//   fixture    no hierarchy, no pills, no icons (the Graph scenario's board)
//   plan       the fixture board plus a hierarchy, typed cards with icons, pills
//   malformed  broken hierarchy, pill and icon entries, to prove a view never breaks
//   ids        plain, prefixed and loose ids (3, 7, G3, _12, DW845) with their prefixes, counters and idDigits
//   notes      the plan board with a logbook: day files for cards 3, 7 and 22 and for nothing
//
// skills/web/test/browser-fixtures.test.js pins what is on each board.

const fs = require('fs');
const path = require('path');

const BOARDS = {
  fixture: { name: 'fixture', layers: ['fixture'] },
  plan: { name: 'plan', layers: ['fixture', 'fixture-plan'] },
  malformed: { name: 'malformed', layers: ['fixture-malformed'] },
  ids: { name: 'ids', layers: ['fixture-ids'] },
  notes: { name: 'notes', layers: ['fixture', 'fixture-plan', 'fixture-notes'] },
};

// Writes board `key` into `dest`, whose contents are cleared first (the folder
// itself stays, since a server may be standing on it), so calling it again puts
// a board back as it was. `port` pins the serving port the way a human would,
// as the first line of the config.
function materialize(key, dest, { port } = {}) {
  const board = BOARDS[key];
  if (!board) throw new Error(`unknown board '${key}': ${Object.keys(BOARDS).join(', ')}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(dest)) fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
  for (const layer of board.layers) fs.cpSync(path.join(__dirname, layer), dest, { recursive: true, force: true });
  if (port) {
    const cfg = path.join(dest, 'config.yaml');
    fs.writeFileSync(cfg, `port: ${port}\n${fs.readFileSync(cfg, 'utf8')}`);
  }
  return dest;
}

module.exports = { BOARDS, materialize };
