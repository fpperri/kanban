const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived, toJSON } = require('../../plugin/skills/web/scripts/card-store');
const { parseSearchQuery, filterCards, searchAddTerm } = require('../../plugin/skills/web/web/search');
const { materialize } = require('./browser/boards');
const { idMap } = require('./helpers/id-map');
const scenarios = require('./browser/scenarios');
const grammar = require('./browser/scenarios/search-grammar');

// The browser runner's search-grammar scenario only runs in a browser (in CI).
// What it expects each query to show is held here to the search module over the
// plan board's own cards, and the scenario is run once against a stand-in page
// so a typo in it fails here and not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-grammar-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir).map(toJSON);
  return { live, all: live.concat(listArchived(dir).map(toJSON)) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const shownBy = (board, query) => {
  const found = new Set(filterCards(board.all, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id));
  return board.live.filter((c) => found.has(c.id)).map((c) => Number(c.id)).sort((a, b) => a - b);
};

test('the scenario is in the runner on the plan board', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'search-grammar'), grammar);
  assert.strictEqual(grammar.board, 'plan');
});

test('the live cards the scenario expects are the plan board\'s live cards', () => {
  const board = planBoard();
  assert.deepStrictEqual(board.live.map((c) => Number(c.id)).sort((a, b) => a - b), grammar.LIVE_IDS);
});

test('each query the scenario types shows, on the Board, the cards the scenario says it shows', () => {
  const board = planBoard();
  for (const [name, { query, shows }] of Object.entries(grammar.CASES)) {
    assert.deepStrictEqual(shownBy(board, query), shows, `${name}: ${query}`);
  }
});

test('the cases separate the grammar from the old forms: each would show other cards if read the old way', () => {
  const board = planBoard();
  assert.notDeepStrictEqual(shownBy(board, 'tags:grill'), shownBy(board, 'tags:"grill"'), 'the quote must change the result');
  assert.notDeepStrictEqual(shownBy(board, 'blocked: review:'), grammar.CASES.stickers.shows, 'an and of the two stickers is not their or');
  assert.notDeepStrictEqual(shownBy(board, 'blocked: | review: tags:docs'), grammar.CASES.stickersWithTag.shows, 'a tag that binds to the last alternative only is not in both');
});

test('the tag cue case is the term interface\'s answer, and the cards are on the board for the click to find', () => {
  const board = planBoard();
  assert.strictEqual(searchAddTerm(grammar.CASES.stickers.query, { field: 'tags', value: 'docs' }), grammar.CASES.stickersWithTag.query);
  const byId = idMap(board.live);
  assert.deepStrictEqual(byId.get(10).tags, ['docs'], 'the review card carries the tag the cue click uses');
  assert.deepStrictEqual(byId.get(9).tags, [], 'and the blocked card does not, so the second alternative matters');
  assert.ok(byId.get(18).waiting_for.every((id) => !byId.has(id)), 'card 18 waits only for a card the board does not have');
});

test('the scenario waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'search-grammar.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('run against a stand-in page, the scenario types each query, clicks the tag, and makes its checks without throwing', async () => {
  const typed = [];
  const clicks = [];
  const checks = [];
  const page = {
    ev: async (expr) => { if (/\.tag'\)\.click/.test(expr)) clicks.push(expr); return ''; },
    send: async (method, params) => { if (method === 'Input.insertText') typed.push(params.text); },
    open: async () => {},
    waitFor: async () => true,
    shot: async () => {},
    check: (name, ok) => checks.push([name, ok]),
  };
  await grammar.run(page);
  assert.deepStrictEqual(typed, [
    grammar.CASES.stickers.query, grammar.CASES.grillSubstring.query, grammar.CASES.grillQuoted.query, grammar.CASES.waiting.query,
  ]);
  assert.strictEqual(clicks.length, 1);
  assert.match(clicks[0], /data-id="10"/);
  assert.deepStrictEqual(checks.map(([name]) => name), [
    'the plan board shows every live card before any search',
    'blocked: | review: shows exactly the blocked cards and the review cards',
    'a tag cue click with blocked: | review: in the box keeps the tag in both alternatives',
    'tags:grill finds the grill card and the grilling card',
    'tags:"grill" hides the grilling card',
    'waiting: shows the waiting cards and not the card waiting only on a missing card',
  ]);
});
