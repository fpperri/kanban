'use strict';
// The board's config reaches the page. On the plan board the page holds the
// hierarchy, the pills and each type's icon after the load and again after a
// poll; on the malformed board it holds what the reader made of the broken
// entries (the blank dropped, the duplicates and the unknown icon passed
// through). The views that draw them (the tier fan, the slice section, the pills, the type icons)
// have scenarios of their own; this one reads the page's own state, so it checks that the load and
// the poll deliver the config whichever view draws it.
//
// The poll check blanks the three values first, so a page that only kept what
// the load gave it fails: the poll has to put them back.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// state, autoRefreshTick.

const BOARD_NAMES = { plan: 'plan', malformed: 'malformed' };

// What each board's config.yaml holds, written out by hand from the fixture
// (skills/web/test/browser-fixtures.test.js pins the fixture).
const EXPECTED = {
  plan: {
    hierarchy: ['goal', 'strategy', 'objective', 'epic'],
    pills: [
      { label: 'next', query: 'tags:"next-up"' },
      { label: 'assignee:@human', query: 'assignee:@human' },
      { label: 'tags:*', query: 'tags:*' },
    ],
    icons: [['goal', 'star'], ['strategy', 'hexagon'], ['objective', 'diamond'], ['epic', 'square'], ['story', 'circle'], ['task', 'triangle'], ['bug', 'blob']],
  },
  malformed: {
    hierarchy: ['Goal', 'goal', 'Epic', 'EPIC'],
    pills: [
      { label: 'tags', query: 'grill' },
      { label: 'assignee:@human', query: 'assignee:@human' },
    ],
    icons: [['goal', 'blob'], ['epic', 'star']],
  },
};

const HELD = `JSON.stringify({ hierarchy: state.hierarchy, pills: state.pills, icons: state.types.filter((t) => t.icon !== undefined).map((t) => [t.name, t.icon]) })`;
const holds = (key) => `${HELD}===${JSON.stringify(JSON.stringify(EXPECTED[key]))}`;

module.exports = {
  name: 'config-keys',
  board: 'plan',
  alsoBoards: ['malformed'],
  EXPECTED,
  async run(page) {
    const { ev, open, waitFor, check } = page;
    for (const key of ['plan', 'malformed']) {
      await open('/', key);
      const loaded = await waitFor(`document.getElementById('project-name').textContent===${JSON.stringify(BOARD_NAMES[key])}&&document.querySelectorAll('#board .card-el').length>0`, 10000);
      check(`${key}: the board loads`, loaded);
      check(`${key}: the page holds the hierarchy, the pills and each type's icon after the load`, await waitFor(holds(key), 4000), await ev(HELD));

      check(`${key}: the three are cleared before the poll`, await ev(`(()=>{state.hierarchy=[];state.pills=[];state.types=[];return state.hierarchy.length===0&&state.pills.length===0&&state.types.length===0})()`));
      await ev(`(async()=>{await autoRefreshTick()})()`);
      check(`${key}: the page holds them again after a poll`, await waitFor(holds(key), 4000), await ev(HELD));
    }
  },
};
