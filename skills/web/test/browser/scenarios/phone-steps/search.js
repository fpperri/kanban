'use strict';
// The phone's search button at 390 by 844 with touch: with the search field closed the header is one
// row; a tap on the button opens the search field across the header and focuses it, and the view bar
// is not displayed while it has focus; typing a query, then closing the field, leaves the Board
// filtered and the button lit; clearing the query puts the button out.

const { tap } = require('../../steps');

const CARDS = `document.querySelectorAll('#board .column .card-el').length`;
const BUTTON = `document.getElementById('search-btn')`;
const TYPE = (text) => `(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const tapButton = async () => {
      const r = await ev(`(()=>{const b=${BUTTON}.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };
    const lit = () => ev(`${BUTTON}.classList.contains('lit')`);

    await open('/');
    check('the Board draws', await waitFor(`${CARDS}>0`, 10000));
    const all = await ev(CARDS);

    const closed = await ev(`(()=>{const h=document.querySelector('header').getBoundingClientRect();const m=document.getElementById('more-btn').getBoundingClientRect();const s=${BUTTON}.getBoundingClientRect();const n=document.getElementById('new-btn').getBoundingClientRect();return {barShown:getComputedStyle(document.querySelector('.search-bar')).display!=='none',gap:Math.round(h.bottom-m.bottom),sameRow:Math.abs((s.top+s.bottom)/2-(n.top+n.bottom)/2)<6,before:s.right<=n.left+1,w:Math.round(s.width)}})()`);
    check('with the field closed the search bar is not displayed', !closed.barShown, closed);
    check('with the field closed the header is one row, the search button beside New card', closed.gap < 20 && closed.sameRow && closed.before && closed.w > 0, closed);
    check('the button is not lit with no query', !(await lit()));

    await tapButton();
    const opened = await ev(`(()=>{const b=document.querySelector('.search-bar').getBoundingClientRect();const h=document.querySelector('header').getBoundingClientRect();const v=document.getElementById('view-bar');return {focus:document.activeElement===document.getElementById('search-input'),spans:b.width>innerWidth-40&&b.left>=0&&b.right<=innerWidth&&b.top>=h.top&&b.bottom<=h.bottom+1,expanded:${BUTTON}.getAttribute('aria-expanded'),bar:getComputedStyle(v).display}})()`);
    check('a tap on the button opens a search field that spans the header', opened.spans, opened);
    check('the input has focus and the button says it is expanded', opened.focus && opened.expanded === 'true', opened);
    const switchFit = await ev(`(()=>{const s=document.getElementById('isolate-switch').getBoundingClientRect();const b=document.querySelector('.search-box').getBoundingClientRect();const r=document.querySelector('.search-bar').getBoundingClientRect();return {shown:s.width>0&&s.height>0,rightOfBox:s.left>=b.right-1,insideBar:s.right<=r.right+1&&s.left>=r.left,inWindow:s.right<=innerWidth,noSideScroll:document.documentElement.scrollWidth<=innerWidth+1,boxWidth:b.width}})()`);
    check('at phone width the Isolate switch stands in the open field, just right of the box, inside the bar and the window, and the box keeps room to type', switchFit.shown && switchFit.rightOfBox && switchFit.insideBar && switchFit.inWindow && switchFit.noSideScroll && switchFit.boxWidth > 120, switchFit);
    check('with the field focused the view bar is not displayed', opened.bar === 'none', opened);

    await ev(TYPE('zzzz-no-such-card'));
    check('typing a query filters the Board', await waitFor(`${CARDS}===0`, 5000), await ev(CARDS));
    await tapButton();
    const after = await ev(`({shown:getComputedStyle(document.querySelector('.search-bar')).display!=='none',text:document.getElementById('search-input').value,bar:getComputedStyle(document.getElementById('view-bar')).display})`);
    check('closing hides the field and keeps the query', !after.shown && after.text === 'zzzz-no-such-card', after);
    check('closing brings the view bar back', after.bar !== 'none', after);
    check('the Board is still filtered and the button is lit', await ev(CARDS) === 0 && await lit());

    await tapButton();
    await ev(TYPE(''));
    check('clearing the query brings the cards back', await waitFor(`${CARDS}===${all}`, 5000), await ev(CARDS));
    check('the button is not lit with the query cleared', !(await lit()));
  },
};
