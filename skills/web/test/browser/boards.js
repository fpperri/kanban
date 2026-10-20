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
//   groups     the plan board with groups (two iterations, a workflow and its subtype, a loose group, a file
//              nested too deep), prefixes for them, and a logbook with one note on a group
//   groupsonly the groups board without its logbook: line (groups on, notes off)
//   scratchpad the groups board with a scratchpad: line and two pages, one for card 7 (with refs) and one for group I2
//   scratchonly the groups board with the logbook line taken out and a scratchpad: line put in (scratchpads on, notes off)
//   calnotes   the notes board with two more notes, so one half hour holds two and one day holds two untimed
//   iterations the groups board with iterations: true, so the header has the iteration dropdown
//   feature    the groups board with all of the feature together: the logbook, the groups (typed, untyped, an
//              iteration that auto-joins), the scratchpad, the iteration dropdown, and a goal with a prefixed
//              id (G11, beside the plain card 11) in the running iteration
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
  groups: { name: 'groups', layers: ['fixture', 'fixture-plan', 'fixture-groups'] },
  iterations: { name: 'iterations', layers: ['fixture', 'fixture-plan', 'fixture-groups', 'fixture-iterations'] },
  groupsonly: { name: 'groupsonly', layers: ['fixture', 'fixture-plan', 'fixture-groups', 'fixture-groups-nolog'] },
  scratchpad: { name: 'scratchpad', layers: ['fixture', 'fixture-plan', 'fixture-groups', 'fixture-scratchpad'] },
  scratchonly: { name: 'scratchonly', layers: ['fixture', 'fixture-plan', 'fixture-groups', 'fixture-groups-nolog', 'fixture-scratchpad-nolog'] },
  feature: { name: 'feature', layers: ['fixture', 'fixture-plan', 'fixture-groups', 'fixture-scratchpad', 'fixture-feature'] },
  calnotes: { name: 'notes', layers: ['fixture', 'fixture-plan', 'fixture-notes', 'fixture-notes-calendar'] },
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
