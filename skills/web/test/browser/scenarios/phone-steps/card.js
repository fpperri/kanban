'use strict';
// A card opens full screen on a phone with a back row. A tap on a card in the Board opens the detail
// filling the viewport; its first row holds '‹ Board' at the left and the edit, archive and delete
// buttons at the right, and full screen, close and copy path are hidden. Back closes the card the
// way the desktop's close does: the address loses card=, and the browser's back and forward reopen
// and close it.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const hasCard = 'new URLSearchParams(location.search).has("card")';
    const noCard = '!new URLSearchParams(location.search).has("card")';
    const shown = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'})()`;

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const point = await ev(`(()=>{const el=document.querySelector('#board .column .card-el');el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await tap(page, point.x, point.y);
    check('a tap on a card opens it', await waitFor(`!document.querySelector('#detail-modal').classList.contains('hidden')&&${hasCard}`, 3000), await ev('location.search'));

    const box = await ev(`(()=>{const r=document.querySelector('#detail-modal .detail-modal').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight}})()`);
    check('the detail fills the viewport', box.l === 0 && box.t === 0 && box.w === box.iw && box.h === box.ih, box);

    const row = await ev(`(()=>{const q=(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}};return {back:q('#detail-back-btn'),edit:q('#detail-edit-btn'),archive:q('#detail-archive-btn'),del:q('#detail-delete-btn'),w:innerWidth}})()`);
    const sameRow = ['edit', 'archive', 'del'].every((k) => row[k].t < row.back.b && row[k].b > row.back.t);
    check('back and the three buttons are on one row, back at the left and the three at the right', sameRow && row.back.l < row.edit.l && row.back.r < row.edit.l && row.del.r > row.w - 40, row);
    check('full screen, close and copy path are hidden', !(await ev(shown('#detail-fullscreen-btn'))) && !(await ev(shown('#detail-close'))) && !(await ev(shown('#detail-copy-btn'))));
    check('there is no status selector in the detail', await ev(`!document.querySelector('#detail-modal select')`));

    const back = await ev(`(()=>{const r=document.querySelector('#detail-back-btn').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await tap(page, back.x, back.y);
    check('back closes the card', await waitFor(`document.querySelector('#detail-modal').classList.contains('hidden')`, 3000));
    check('and the address has no card=', await waitFor(noCard, 3000), await ev('location.search'));

    await ev('history.back()');
    check('the browser\'s back reopens the card', await waitFor(`!document.querySelector('#detail-modal').classList.contains('hidden')&&${hasCard}`, 3000), await ev('location.search'));
    await ev('history.forward()');
    check('the browser\'s forward closes it', await waitFor(`document.querySelector('#detail-modal').classList.contains('hidden')&&${noCard}`, 3000), await ev('location.search'));
  },
};
