'use strict';
// The search grammar on the Board, on the plan board: an or between sticker
// scopes, a tag cue click inside it, a quoted tag and `waiting:`. What each
// query shows is written down in CASES, and skills/web/test/browser-search-grammar.test.js
// holds those lists to the search module over the plan board's own cards, so a
// wrong expectation fails in the unit suite and not only in a browser.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Card 9 is blocked and
// card 10 awaits review; card 10 carries the docs tag and card 9 carries none.
// Cards 8 and 13 carry the tags grill and grilling. Cards 4, 6 and 8 wait for a
// card that is not done; card 18 waits only for the missing card 90 and card 27
// only for the done card 5.

const LIVE_IDS = [...Array.from({ length: 18 }, (_, i) => i + 1), ...Array.from({ length: 8 }, (_, i) => i + 22)];

const CASES = {
  stickers: { query: 'blocked: | review:', shows: [9, 10] },
  stickersWithTag: { query: 'blocked: tags:docs | review: tags:docs', shows: [10] },
  grillSubstring: { query: 'tags:grill', shows: [8, 13] },
  grillQuoted: { query: 'tags:"grill"', shows: [8] },
  waiting: { query: 'waiting:', shows: [4, 6, 8] },
};

module.exports = {
  name: 'search-grammar',
  board: 'plan',
  LIVE_IDS,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, shot, check } = page;
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boardShows = (wanted, ms) => waitFor(`JSON.stringify([...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b))===${JSON.stringify(JSON.stringify(wanted))}`, ms);
    const shownNow = () => ev(`[...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b)`);
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boardShows(LIVE_IDS);
    };
    const typeQuery = async (text) => {
      await clearBox();
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text });
    };

    await open('/');
    check('the plan board shows every live card before any search', await boardShows(LIVE_IDS, 10000), await shownNow());

    await typeQuery(CASES.stickers.query);
    check('blocked: | review: shows exactly the blocked cards and the review cards', (await boardShows(CASES.stickers.shows)) && (await boxText()) === CASES.stickers.query, { box: await boxText(), shown: await shownNow() });

    await ev(`document.querySelector('#board .card-el[data-id="10"] .tag').click()`);
    check('a tag cue click with blocked: | review: in the box keeps the tag in both alternatives', (await boxText()) === CASES.stickersWithTag.query && (await boardShows(CASES.stickersWithTag.shows)), { box: await boxText(), shown: await shownNow() });
    await shot('search-grammar-or');

    await typeQuery(CASES.grillSubstring.query);
    check('tags:grill finds the grill card and the grilling card', await boardShows(CASES.grillSubstring.shows), await shownNow());
    await typeQuery(CASES.grillQuoted.query);
    check('tags:"grill" hides the grilling card', (await boardShows(CASES.grillQuoted.shows)) && (await boxText()) === CASES.grillQuoted.query, { box: await boxText(), shown: await shownNow() });

    await typeQuery(CASES.waiting.query);
    check('waiting: shows the waiting cards and not the card waiting only on a missing card', (await boardShows(CASES.waiting.shows)) && !(await shownNow()).includes(18), await shownNow());
    await shot('search-grammar-waiting');
  },
};
