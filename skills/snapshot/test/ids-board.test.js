const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards } = require('../../web/web/search');
const { sortIds } = require('../../web/web/ids');
const { planCards, webContext, withBoardPage } = require('./search-table');
const scenario = require('../../web/test/browser/scenarios/ids');

// The browser runner's ids board holds plain cards (3, 7, 9, 10), goals (G3, G4, G10; G2
// archived), a two-letter prefix (DW845) and the loose prefix (_12): card 3 and goal G3 share
// a number. The snapshot reads every one of them under its whole id, from the id line, and its
// search answers a whole-id query exactly as the web's search module does.

const shown = (page) => page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => n.dataset.card);

test('the builder reads all ten cards of the ids board under their whole ids, the archived goal among them', () => {
  withBoardPage('ids', (page) => {
    const data = page.plain(page.run('DATA'));
    assert.deepStrictEqual(sortIds(data.map((c) => c.id)), ['3', '7', '9', '10', 'DW845', 'G2', 'G3', 'G4', 'G10', '_12']);
    const by = Object.fromEntries(data.map((c) => [c.id, c]));
    assert.deepStrictEqual(by.DW845.w, ['G3', '3']);
    assert.deepStrictEqual(by.G4.w, ['G3']);
    assert.deepStrictEqual(['7', 'G10', '_12'].map((id) => by[id].pt), ['G3', 'G3', 'G3']);
    assert.strictEqual(by['3'].pt, null);
  });
});

test('a whole-id query shows the card it names and no other, as the web search does', () => {
  withBoardPage('ids', (page, dir) => {
    const cards = planCards(dir);
    for (const { query, shows } of scenario.CASES.search) {
      const web = sortIds(filterCards(cards, parseSearchQuery(query, 'ids'), webContext(dir)).filter((c) => !c.archived).map((c) => c.id));
      assert.deepStrictEqual(web, shows, `the web: ${query}`);
      page.type(page.byId('q'), query);
      assert.deepStrictEqual(sortIds([...new Set(shown(page).filter((id) => id !== 'G2'))]), shows, `the snapshot: ${query}`);
    }
  });
});

test('the board lists every live card once, card 3 and goal G3 as two tiles', () => {
  withBoardPage('ids', (page) => {
    page.type(page.byId('q'), '');
    assert.deepStrictEqual(sortIds([...new Set(shown(page).filter((id) => id !== 'G2'))]), scenario.CASES.live);
  });
});
