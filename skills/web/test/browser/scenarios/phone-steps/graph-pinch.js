'use strict';
// A two-finger pinch on the Graph grows its zoom and ends in no tap: no card opens, the selection
// stays and isDragging is false again.

const { pinch } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, centre, check, sleep } = page;
    await open('/?view=graph');
    check('the Graph draws at phone width', await waitFor(`!!graphCur&&document.querySelectorAll('.graph-node').length>0`, 10000));
    let settled = await ev(`graphCur.view.k`);
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const now = await ev(`graphCur.view.k`);
      if (now === settled) break;
      settled = now;
    }
    const before = await ev(`({k:graphCur.view.k,sel:[...selectedIds].sort().join(','),href:location.href})`);
    const c = await centre('.graph-canvas');
    await pinch(page, c, { from: 80, to: 240 });
    check('a pinch grows the Graph\'s zoom', await waitFor(`graphCur.view.k>${before.k}*1.5`, 4000), await ev(`graphCur.view.k`));
    const after = await ev(`({sel:[...selectedIds].sort().join(','),href:location.href,drag:isDragging,card:/[?&]card=/.test(location.search)})`);
    check('no card is open after the pinch', !after.card, after);
    check('the selection is unchanged', after.sel === before.sel, { before: before.sel, after: after.sel });
    check('isDragging is false again', after.drag === false, after);
  },
};
