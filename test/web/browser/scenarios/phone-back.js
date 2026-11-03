'use strict';
// Android Back at phone width, with touch: 390 by 844 on the plan board. Its steps are the files in
// phone-back-steps/, run in name order, each from a clean page and clean storage (steps.js), the way the
// phone scenario runs its own. They are a scenario of their own because each step presses Back with
// history.back() several times and waits for the page between presses: on CI's runner, where the limits are
// not scaled, the phone scenario's own steps take about a minute of its 120 s and these about as much again, so
// together they would crowd the one limit. (A local run lengthens every limit 4 times, which hides it.)

const path = require('path');
const phone = require('./phone');

module.exports = {
  name: 'phone-back',
  board: 'plan',
  alsoBoards: ['feature'],
  timeoutMs: 120000,
  start: phone.start,
  run: (page, { stepsDir = path.join(__dirname, 'phone-back-steps') } = {}) => phone.run(page, { stepsDir }),
};
