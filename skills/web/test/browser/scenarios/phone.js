'use strict';
// The Web at phone width, with touch: 390 by 844, on the plan board with the feature board
// alongside. Its steps are the files in phone-steps/, run in name order, each from a clean page and
// clean storage (steps.js). Touch emulation is turned off when the steps end, whatever they did.

const path = require('path');
const { runSteps } = require('../steps');

const START = { width: 390, height: 844, touch: true };

module.exports = {
  name: 'phone',
  board: 'plan',
  alsoBoards: ['feature'],
  timeoutMs: 120000,
  start: START,
  async run(page, { stepsDir = path.join(__dirname, 'phone-steps') } = {}) {
    try {
      await runSteps(page, stepsDir, START);
    } finally {
      try { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); } catch (e) { /* the scenario is over; the next one's start turns touch off */ }
    }
  },
};
