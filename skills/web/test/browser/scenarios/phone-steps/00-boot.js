'use strict';
// The plan board loads at 390 by 844 with touch on, and its Board draws. The scenario's closing
// check covers console errors.

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    await open('/');
    check('the plan board loads at 390 by 844 with touch on', await waitFor(`innerWidth===390&&innerHeight===844&&navigator.maxTouchPoints>0`), await ev(`({w:innerWidth,h:innerHeight,t:navigator.maxTouchPoints})`));
    check('and its Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
  },
};
