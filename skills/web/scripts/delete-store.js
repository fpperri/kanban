'use strict';
// Deleting a card or a group, and what goes with it (GLOSSARY.md "Ids, groups and the
// logbook"). A card's id always leaves every group's list, so no group points at a gone
// card. The rest is the person's say, each unticked in the delete popup: the extras in
// SWEEPS, each a function of the board and the target (a card or a group id) that deletes the
// files kept for that target and returns how many. Deleting a group can also delete its member
// cards, but never one another group still lists.
//
// A new kind of file kept per target joins the popup by adding one entry to SWEEPS; the
// options a request sends are the keys that are `true`, nothing else is read.
const cs = require('./card-store');
const gs = require('./group-store');
const lb = require('./logbook-store');
const ids = require('../web/ids');

const SWEEPS = {
  logbook: (dir, target) => lb.deleteTargetFiles(dir, target),
};

// Run the extras the options ask for on one target: { logbook: 2 } for what was asked, nothing
// for what was not (even when it found no file).
function sweep(dir, target, options) {
  const swept = {};
  for (const [key, run] of Object.entries(SWEEPS)) {
    if (options && options[key] === true) swept[key] = run(dir, target);
  }
  return swept;
}

// The card's file, then its id out of every group; { groups, swept }. Throws what the card
// store throws for a card that is not there.
function deleteCard(dir, id, options) {
  cs.deleteCard(dir, id);
  return { groups: gs.dropCard(dir, id), swept: sweep(dir, id, options) };
}

// The group's file, its extras if asked, and with options.members the member cards no other
// group holds: { deleted: [card ids], kept: [{ id, groups }], swept }. A member that is no card
// of the board is neither.
function deleteGroup(dir, id, options) {
  const group = gs.deleteGroup(dir, id);
  const swept = sweep(dir, group.id, options);
  const deleted = [];
  const kept = [];
  if (options && options.members === true) {
    for (const member of group.cards) {
      if (!cs.findCardFile(dir, member)) continue;
      const others = gs.groupsHolding(dir, member).map((f) => f.group.id);
      if (others.length) { kept.push({ id: member, groups: others }); continue; }
      cs.deleteCard(dir, member);
      deleted.push(member);
    }
  }
  return { deleted: ids.sortIds(deleted), kept, swept };
}

module.exports = { SWEEPS, deleteCard, deleteGroup };
