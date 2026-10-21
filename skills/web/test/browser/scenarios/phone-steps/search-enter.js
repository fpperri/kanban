'use strict';
// Enter in the phone's search field at 390 by 844 with touch: typing #7 and pressing Enter closes
// the field and its panel, keeps the query and the filter, drops the keyboard (the box has no
// focus), and puts keyboard focus on card 7 in the Board, switched to card 7's status tab; a second
// Enter opens its details.

const { tap } = require('../../steps');

const BUTTON = `document.getElementById('search-btn')`;
const TYPE = (text) => `(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;

module.exports = {
  async run(page) {
    const { ev, open, waitFor, key, check } = page;
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const r = await ev(`(()=>{const b=${BUTTON}.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
    await tap(page, r.x, r.y);
    check('the field is open with focus in the box', await waitFor(`document.activeElement===document.getElementById('search-input')`, 3000));
    await ev(TYPE('#7'));
    check('the query filters the Board', await waitFor(`!document.getElementById('search-clear-btn').classList.contains('hidden')`, 5000));
    await key('Enter');
    check('Enter closes the field and keeps the query', (await waitFor(`getComputedStyle(document.querySelector('.search-bar')).display==='none'`, 3000)) && (await ev(`document.getElementById('search-input').value`)) === '#7');
    check('the box has no focus and card 7 has it, inside the viewport', await waitFor(`(()=>{const a=document.activeElement;if(!a||!a.classList.contains('card-el')||a.dataset.id!=='7')return false;const q=a.getBoundingClientRect();return q.top>=0&&q.bottom<=innerHeight&&q.left>=0&&q.right<=innerWidth})()`, 3000));
    await key('Enter');
    check('a second Enter opens the details', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`, 3000));
  },
};
