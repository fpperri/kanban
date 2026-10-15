'use strict';
// What the tier fan's tests stand on: the browser runner's own fixture boards,
// read the way the page reads them, and a small card builder for boards written
// by hand. Not a test file (the suite runs *.test.js only).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived } = require('../../scripts/card-store');
const { readConfig } = require('../../scripts/config-store');
const { materialize } = require('../browser/boards');
const { graphBuild } = require('../../web/graph-model');

const STATUSES = ['backlog', 'todo', 'doing', 'done'];
const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

const roots = [];

// A fixture board: its live and archived cards and its config, with the context
// the page builds the Graph in.
function loadBoard(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-fan-${key}-`));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir);
  const config = readConfig(dir);
  return { name: config.name, config, live, all: live.concat(listArchived(dir)), ctx: { board: config.name, priorities: config.priorities } };
}

function cleanUp() {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
}

const card = (id, extra = {}) => ({
  id, title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});

// The model the page draws: every live card, or `visible` of them, with the board's hierarchy.
const drawnModel = (board, { visible = null, hierarchy = board.config.hierarchy } = {}) => graphBuild(board.all, {
  ctx: board.ctx, hierarchy, visibleIds: new Set(visible || board.live.map((c) => c.id)),
});

// A model of cards written by hand.
const buildOf = (cards, hierarchy = HIERARCHY, visible = null) => graphBuild(cards, {
  ctx: CTX, hierarchy, visibleIds: visible ? new Set(visible) : null,
});

module.exports = { STATUSES, HIERARCHY, CTX, loadBoard, cleanUp, card, drawnModel, buildOf };
