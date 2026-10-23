'use strict';
// The search box on the Board, on the fixture board: each way of writing the box
// (typing, the clear button, a cue click, a ?q= link) changes the box and the
// cards the columns show; Dependency path from a card's menu adds to the selection and
// leaves the box and the columns alone. The card menu is opened by the runner's
// right-click helper. The sets are the fixture's own: 18 live cards, all
// assigned to @human, card 9 blocked, card 10 awaiting review, and card 4's
// dependency path is 3, 4.

module.exports = {
  name: 'search-box',
  board: 'fixture',
  async run(page) {
    const { ev, send, open, waitFor, shot, check } = page;
    const liveIds = Array.from({ length: 18 }, (_, i) => i + 1);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boardShows = (wanted, ms) => waitFor(`JSON.stringify([...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b))===${JSON.stringify(JSON.stringify(wanted))}`, ms);
    const shownNow = () => ev(`[...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b)`);
    const markedNow = () => ev(`[...new Set([...document.querySelectorAll('#board .card-el.selected')].map((e) => Number(e.dataset.id)))].sort((a, b) => a - b)`);
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boardShows(liveIds);
    };

    await open('/');
    check('the board shows every live card before any search', await boardShows(liveIds, 10000), await shownNow());

    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: 'zephyr' });
    check('typing writes the box and narrows the columns', (await boardShows([1, 2, 7, 11])) && (await boxText()) === 'zephyr', { box: await boxText(), shown: await shownNow() });
    check('the clear button empties the box and brings every card back', (await clearBox()) && (await boxText()) === '', { box: await boxText() });

    await ev(`document.querySelector('#board .card-el[data-id="1"] .card-assignee').click()`);
    check('an assignee cue click writes assignee:@human', (await boxText()) === 'assignee:@human' && (await boardShows(liveIds)), { box: await boxText() });
    await ev(`document.querySelector('#board .card-el[data-id="1"] .card-assignee').click()`);
    check('the same cue clicked again leaves the box as it was', (await boxText()) === 'assignee:@human');
    await clearBox();

    await ev(`document.querySelector('#board .card-el[data-id="9"] .blocked-pill').click()`);
    check('a blocked pill click writes blocked: and keeps the blocked cards', (await boxText()) === 'blocked:' && (await boardShows([9])), { box: await boxText(), shown: await shownNow() });
    await ev(`document.querySelector('#board .card-el[data-id="9"] .card-assignee').click()`);
    check('a second cue adds to the box', (await boxText()) === 'blocked: assignee:@human' && (await boardShows([9])), { box: await boxText() });
    await clearBox();
    await ev(`document.querySelector('#board .card-el[data-id="10"] .review-pill').click()`);
    check('a review pill click writes review: and keeps the cards awaiting review', (await boxText()) === 'review:' && (await boardShows([10])), { box: await boxText(), shown: await shownNow() });
    await clearBox();

    await page.rightClick('#board .card-el[data-id="4"]');
    check('a right-click on a card opens its menu', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`));
    await ev(`document.getElementById('ctx-dpath').click()`);
    check('Dependency path from the menu adds that card\'s dependency path to the selection and leaves the box empty', (await boxText()) === '' && (await boardShows(liveIds)) && JSON.stringify(await markedNow()) === '[3,4]', { box: await boxText(), shown: await shownNow(), marked: await markedNow() });
    check('and the menu closes', await ev(`document.getElementById('context-menu').classList.contains('hidden')`));
    await shot('search-path');

    await open('/?q=status%3Adoing');
    check('a ?q= link writes the box and narrows the columns', (await waitFor(`document.getElementById('search-input').value==='status:doing'`)) && (await boardShows([1, 2, 9, 15])), { box: await boxText(), shown: await shownNow() });
  },
};
