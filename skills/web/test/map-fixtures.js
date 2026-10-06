'use strict';
// Shapes of real boards, trimmed to the fields the map reads: a family whose
// sibling chain ends in one child, and a tree with archived and backlog children.

const card = (id, status, extra = {}) => ({
  id, title: `card ${id}`, status, archived: false, priority: 'Normal', waiting_for: [], ...extra,
});

// A nine-child family whose sibling chain ends in one child (19) and starts in
// two (11 and 12); the parent is done, one child is still doing.
function familyChainingToOneEnd() {
  const parent = 10;
  return [
    card(10, 'done'),
    card(11, 'done', { parent }),
    card(12, 'done', { parent }),
    card(13, 'done', { parent, waiting_for: [11] }),
    card(14, 'done', { parent, waiting_for: [12] }),
    card(15, 'done', { parent, waiting_for: [12] }),
    card(16, 'done', { parent, waiting_for: [12] }),
    card(17, 'doing', { parent, waiting_for: [11, 13] }),
    card(18, 'done', { parent, waiting_for: [11, 14, 15] }),
    card(19, 'backlog', { parent, waiting_for: [16, 17, 18] }),
  ];
}

// A backlog parent with two backlog children nobody waits on, and nine archived
// children, seven of them in one sibling web.
function treeWithArchivedAndBacklogChildren() {
  const parent = 40;
  const done = (id, extra) => card(id, 'done', { parent, archived: true, ...extra });
  return [
    card(40, 'backlog', { priority: 'High' }),
    done(41),
    done(42, { waiting_for: [41] }),
    done(43, { waiting_for: [42] }),
    done(44, { waiting_for: [41, 50] }),
    done(45, { waiting_for: [42, 44, 46] }),
    done(46, { waiting_for: [41] }),
    card(47, 'backlog', { parent }),
    card(48, 'backlog', { parent, priority: 'Low' }),
    done(49),
    done(50),
    done(51),
  ];
}

module.exports = { card, familyChainingToOneEnd, treeWithArchivedAndBacklogChildren };
