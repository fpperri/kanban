'use strict';
// The notes palette on a 390 px phone does what the card details do: it fills the viewport, has no
// full screen button, and a key that toggles full screen on a desktop changes nothing here and saves
// no choice. The note box keeps its ordinary cap, and Esc closes the palette. Run on the feature
// board, which keeps a logbook.

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check, key } = page;
    const PAL = `document.getElementById('notes-palette')`;
    const saved = `localStorage.getItem('kanban.'+state.projectName+'.modal.fullscreen')`;

    await open('/', 'feature');
    check('feature: the Board draws', await waitFor(`document.querySelectorAll('#board .column').length===1&&document.querySelectorAll('#board-tabs .board-tab').length>0&&state.active.length>0`, 10000));
    await ev(`openNotes({ kind: 'card-notes', id: state.active[0].id })`);
    check('the palette opens', await waitFor(`!!${PAL}&&!${PAL}.classList.contains('hidden')`, 3000));

    const box = await ev(`(()=>{const r=${PAL}.getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight}})()`);
    check('the palette fills the viewport', box.l === 0 && box.t === 0 && box.w === box.iw && box.h === box.ih, box);
    check('its full screen button is not shown', await ev(`(()=>{const b=document.getElementById('notes-fullscreen-btn');return !b||b.hidden||getComputedStyle(b).display==='none'})()`));
    check('the note box and the list sit inside the viewport', await ev(`(()=>{const q=(s)=>document.querySelector('#notes-palette '+s).getBoundingClientRect();return q('.np-input').bottom<=innerHeight&&q('.np-body').bottom<=innerHeight})()`));

    await key('Enter', { alt: true });
    check('Alt+Enter changes nothing: the palette stays full screen and nothing is saved', await ev(`${PAL}.classList.contains('fullscreen')&&${saved}===null`));
    await key('Escape');
    await key('Escape');
    check('Esc closes the palette', await waitFor(`${PAL}.classList.contains('hidden')`, 3000));
  },
};
