'use strict';
// The board's hidden `.applied-ids` file: the id of every queued change the apply has landed, one per line.
// The apply skips a record whose id is in it, and the build reads the highest number each device took, so a
// page built later never hands out a number the board has already applied. Node only.
const fs = require('fs');
const path = require('path');

const APPLIED_FILE = '.applied-ids';

const readApplied = (dir) => {
  const file = path.join(dir, APPLIED_FILE);
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
};

// { device: highest number } over ids shaped <device>-<number>; anything else in the file is left out.
function takenBy(applied) {
  const taken = {};
  for (const id of applied) {
    const m = /^(.+)-(\d+)$/.exec(id);
    if (m) taken[m[1]] = Math.max(taken[m[1]] || 0, Number(m[2]));
  }
  return taken;
}

module.exports = { APPLIED_FILE, readApplied, takenBy };
