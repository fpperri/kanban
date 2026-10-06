// Helpers for the nesting tests that run the built page: open a board, find a
// card's tile, column or sheet the way a person would. Not a test file.
const { card, withSnapshot } = require('./nesting-fixture');
const { loadPage, byClass } = require('./page-harness');

const WIDE = { matchMedia: (q) => q.includes('min-width:900px') };

function open(board, fn) {
  return withSnapshot(board, (html, dir) => fn(loadPage(html, WIDE), dir));
}

const tiles = (page) => page.byId('board').all().filter((n) => n.classList.contains('card'));
const tile = (page, id) => tiles(page).find((n) => n.dataset.card === String(id));
const column = (page, status) => page.byId('board').all()
  .find((n) => n.classList.contains('boardcol') && n.dataset.status === status);
const idsIn = (page, status) => byClass(column(page, status), 'card').map((n) => Number(n.dataset.card));

// Taps the card's tile and returns the sheet that opens.
function sheet(page, id) {
  page.click(tile(page, id));
  return page.byId('modalscroll').children[0];
}

// A small board from [id, status, title, extra] rows, statuses todo and done.
function board(config, cards, archived) {
  const named = (rows) => Object.fromEntries(rows.map(([id, status, title, extra]) =>
    [`${String(id).padStart(4, '0')}.c.card.md`, card(id, status, title, extra)]));
  return { config: `name: order\nstatuses: [todo, done]\n${config || ''}`, cards: named(cards), archived: archived ? named(archived) : undefined };
}

module.exports = { board, column, idsIn, open, sheet, tile, tiles };
