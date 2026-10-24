'use strict';
// Enter in the search box goes to the match, on the fixture board's Board. The query is typed with
// Input.insertText, a trusted input, so the suggestion list is open when Enter comes, as for a person.
// Typing #7 and pressing Enter once closes the search panel, keeps the query in the box, takes the box's
// focus off, puts keyboard focus on card 7 (wearing the focus ring) with the card in the middle of the
// viewport (or as near it as the Board can scroll); a second Enter opens its details, because it was the
// only match. Typing zephyr (cards 1, 2, 7 and 11) and pressing Enter focuses the first of them in the
// Board's reading order, and a second Enter opens nothing, as before. With nothing matching, Enter changes
// nothing and the box keeps its focus. The runner's key helper is a real key press. Each step waits on the
// page, never on a fixed sleep; a check that something stayed closed waits a bounded 600 ms for it to
// open, since the details are fetched first.

module.exports = {
  name: 'search-enter',
  board: 'fixture',
  async run(page) {
    const { ev, send, open, waitFor, key, check } = page;
    const BOX = `document.getElementById('search-input')`;
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')`;
    const detailOpen = `!document.getElementById('detail-modal').classList.contains('hidden')`;
    const focused = () => ev(`(()=>{const a=document.activeElement;return a&&a.classList&&a.classList.contains('card-el')?a.dataset.id:null})()`);
    const stays = async (expr) => !(await waitFor(expr, 600));
    const centred = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');const r=el.getBoundingClientRect();if(!(r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth))return false;let s=el.parentElement;while(s&&s!==document.documentElement&&!(s.scrollHeight>s.clientHeight&&getComputedStyle(s).overflowY!=='visible'))s=s.parentElement;s=s||document.scrollingElement;const atLimit=s.scrollTop<=1||s.scrollTop+s.clientHeight>=s.scrollHeight-1;const vh=s===document.scrollingElement||s===document.documentElement?innerHeight:s.getBoundingClientRect().height;const top=s===document.scrollingElement||s===document.documentElement?0:s.getBoundingClientRect().top;return atLimit||Math.abs((r.top+r.bottom)/2-(top+vh/2))<=vh*0.15})()`);
    const typeQuery = async (text) => {
      await ev(`${BOX}.focus()`);
      await send('Input.insertText', { text });
    };
    const reset = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    };

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000));

    await typeQuery('#7');
    check('typing #7 opens the panel and narrows the Board to card 7', (await waitFor(panelOpen)) && (await waitFor(`document.querySelectorAll('#board .card-el').length===1`)));
    await key('Enter');
    check('Enter closes the panel and keeps the query', (await waitFor(`!(${panelOpen})`)) && (await ev(`${BOX}.value`)) === '#7');
    check('the box lets go of focus and card 7 has it', (await waitFor(`document.activeElement!==${BOX}`)) && (await focused()) === '7', await focused());
    check('card 7 wears its focus ring and sits inside the viewport', (await ev(`document.activeElement.matches(':focus-visible')`)) && (await centred(7)));
    check('the first Enter opened no details', await stays(detailOpen));
    await key('Enter');
    check('a second Enter opens the details of the only match', await waitFor(`${detailOpen}`, 3000));
    await key('Escape');
    await waitFor(`!(${detailOpen})`);
    await reset();

    await typeQuery('zephyr');
    check('typing zephyr narrows the Board to four cards', await waitFor(`document.querySelectorAll('#board .card-el').length===4`));
    const first = await ev(`document.querySelector('#board .card-el').dataset.id`);
    await key('Enter');
    check('Enter focuses the first match in reading order and closes the panel', (await waitFor(`!(${panelOpen})`)) && (await waitFor(`(()=>{const a=document.activeElement;return !!a&&a.classList.contains('card-el')&&a.dataset.id===${JSON.stringify(first)}})()`)), await focused());
    await key('Enter');
    check('with four matches a second Enter opens nothing', await stays(detailOpen));
    await reset();

    await typeQuery('zzzz-no-such-card');
    await waitFor(`document.querySelectorAll('#board .card-el').length===0`);
    await key('Enter');
    check('with nothing matching, Enter leaves the box focused and the panel as it was', (await ev(`document.activeElement===${BOX}`)) && (await ev(panelOpen)));
  },
};
