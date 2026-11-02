'use strict';
// Android Back at phone width, with touch: 390 by 844 on the plan board. Its steps are the files in
// phone-back-steps/, run in name order, each from a clean page and clean storage (steps.js), the way the
// phone scenario runs its own. They are a scenario of their own because each step presses Back with
// history.back() several times and waits for the page between presses, which together took a third of the
// phone scenario's 120 s on a throttled run and left it close to the limit on CI.

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
