'use strict';
// The Web as a window crosses the phone width line and comes back, with no touch: starts at 390 by
// 844 on the plan board. Its steps are the files in phone-flip-steps/, run in name order, each from a
// clean page and clean storage (steps.js).

const path = require('path');
const { runSteps } = require('../steps');

const START = { width: 390, height: 844, touch: false };

module.exports = {
  name: 'phone-flip',
  board: 'plan',
  timeoutMs: 120000,
  start: START,
  async run(page, { stepsDir = path.join(__dirname, 'phone-flip-steps') } = {}) {
    await runSteps(page, stepsDir, START);
  },
};
