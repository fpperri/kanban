'use strict';
// The phone's tap grammar is the width line, not touch: with a mouse at 390 a click on a card toggles
// it into the selection; the window widened to 800 gives the desk's click, which opens the card and
// drops the selection; narrowed again the click toggles once more. The preferences sheet follows the
// line the same way: A plain click on a card above it, A tap on a card under it. No reload.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check } = page;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const hasCard = `new URLSearchParams(location.search).has('card')&&!document.querySelector('#detail-modal').classList.contains('hidden')`;
    const detailShut = `document.querySelector('#detail-modal').classList.contains('hidden')`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    const clickCard = async (n) => {
      const sel = `#board .column .card-el:nth-of-type(${n}) .card-title`;
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`);
      const p = await centre(sel);
      await click(p.x, p.y);
    };
    const display = (sel) => `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).display`;

    await open('/');
    check('at 390 the Board draws', await waitFor(`innerWidth===390&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev(`window.__noReload=true`);
    const [a, b, c] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0, 3).map((e)=>e.dataset.id)`);
    await clickCard(1);
    check('at 390 a click on a card selects it', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000), await ev(picked));
    await clickCard(2);
    check('and a click on another adds it', await waitFor(`${picked}===${JSON.stringify([a, b].sort((x, y) => x - y).join())}`, 3000), await ev(picked));
    check('and opens nothing', await ev(detailShut));

    await resize(800);
    check('at 800 the Board draws as the desk\'s', await waitFor(`innerWidth===800&&document.querySelectorAll('#board-tabs .board-tab').length===0`, 10000));
    await clickCard(3);
    check('at 800 a click on a card opens it', await waitFor(hasCard, 3000), await ev('location.search'));
    check('and drops the selection, as it always did', await ev(`${picked}===''`), await ev(picked));
    await key('Escape');
    check('Esc closes the card', await waitFor(detailShut, 3000));

    await resize(390);
    check('back at 390 the Board is the phone\'s', await waitFor(`innerWidth===390&&document.querySelectorAll('#board-tabs .board-tab').length>1&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await clickCard(3);
    check('a click selects again', await waitFor(`${picked}===${JSON.stringify(c)}`, 3000), await ev(picked));
    check('and opens nothing', await ev(detailShut));

    await resize(800);
    await waitFor(`innerWidth===800`, 10000);
    await ev(`document.getElementById('prefs-btn').click()`);
    check('at 800 the sheet shows A plain click on a card and not A tap on a card', await waitFor(`${display('.prefs-desk-group')}!=='none'&&${display('.prefs-phone-group')}==='none'`, 3000), await ev(`${display('.prefs-desk-group')}+' '+${display('.prefs-phone-group')}`));
    await resize(390);
    check('narrowed with the sheet open, it swaps to A tap on a card', await waitFor(`innerWidth===390&&${display('.prefs-desk-group')}==='none'&&${display('.prefs-phone-group')}!=='none'`, 3000), await ev(`${display('.prefs-desk-group')}+' '+${display('.prefs-phone-group')}`));
    await resize(800);
    check('widened again, it swaps back', await waitFor(`innerWidth===800&&${display('.prefs-desk-group')}!=='none'&&${display('.prefs-phone-group')}==='none'`, 3000), await ev(`${display('.prefs-desk-group')}+' '+${display('.prefs-phone-group')}`));
    check('the page was not reloaded', await ev(`window.__noReload===true`));
  },
};
