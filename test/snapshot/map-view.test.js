const { test, describe } = require('node:test');
const assert = require('node:assert');
const { card, withSnapshot } = require('./nesting-fixture');
const { byClass, loadPage } = require('./page-harness');

// The Map tab as a person sees it: the page is built from a small board, run, and the
// SVG it draws is read back (where each card sits, which lines join which cards).

const CONFIG = [
  'name: map',
  'statuses: [backlog, todo, doing, done]',
  'types:',
  '  - name: epic',
  '    color: "#a371f7"',
  '',
].join('\n');

const file = (rows) => Object.fromEntries(rows.map(([id, status, title, extra]) =>
  [`${String(id).padStart(4, '0')}.c.card.md`, card(id, status, title, extra)]));

function open(rows, fn, archived) {
  const board = { config: CONFIG, cards: file(rows), archived: archived ? file(archived) : undefined };
  return withSnapshot(board, (html) => {
    const page = loadPage(html);
    return fn(page, page.byId('mapview'));
  });
}

const redraw = (page) => { page.run('renderMap()'); return page.byId('mapview'); };

const graphs = (view) => byClass(view, 'map-scroll').map((wrap) => wrap.children[0]);
const nodesOf = (svg) => byClass(svg, 'mnode');
const labelOf = (g) => byClass(g, 'mid')[0].textContent;
const boxOf = (g, width) => {
  const at = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.attrs.transform);
  const rect = g.children.find((c) => c.tagName === 'RECT');
  return { label: labelOf(g), x: Number(at[1]), y: Number(at[2]), w: width, h: Number(rect.attrs.height) };
};
const boxes = (page, svg) => nodesOf(svg).map((g) => boxOf(g, Number(page.run('MW'))));
const boxFor = (page, svg, label) => boxes(page, svg).find((b) => b.label === label);

// "4>1" for a dashed parent line that leaves the bottom of card 4 and ends at the top of card 1.
function parentLines(page, svg) {
  const all = boxes(page, svg);
  const at = (x, y, edge) => all.find((b) => x >= b.x && x <= b.x + b.w && y === (edge === 'top' ? b.y : b.y + b.h));
  return byClass(svg, 'mpline').map((p) => {
    const n = p.attrs.d.match(/-?\d+(\.\d+)?/g).map(Number);
    const from = at(n[0], n[1], 'bottom');
    const to = at(n[n.length - 2], n[n.length - 1], 'top');
    assert.ok(from && to, `a parent line joins two cards: ${p.attrs.d}`);
    return `${from.label.replace(/^#/, '')}>${to.label.replace(/^#/, '')}`;
  }).sort();
}

const text = (view, cls) => byClass(view, cls).map((n) => n.textContent);

const FAMILY = [
  [1, 'doing', 'Ship'],
  [2, 'done', 'Spec', { parent: 1 }],
  [3, 'done', 'Build', { parent: 1, waiting_for: '[2]' }],
  [4, 'todo', 'Test', { parent: 1, waiting_for: '[3]' }],
  [5, 'backlog', 'Docs', { parent: 1 }],
];

describe('parent lines', () => {
  test('a parent has a dashed line to the child that ends each chain of its children, and the parent sits below them', () => {
    open(FAMILY, (page, view) => {
      const [svg] = graphs(view);
      assert.deepStrictEqual(parentLines(page, svg), ['4>1', '5>1']);
      const parent = boxFor(page, svg, '#1');
      for (const child of ['#2', '#3', '#4', '#5']) assert.ok(boxFor(page, svg, child).y < parent.y, `${child} is above its parent`);
    });
  });

  test('the dependencies are the solid arrows and the parent lines end in a dot, not an arrowhead', () => {
    open(FAMILY, (page, view) => {
      const [svg] = graphs(view);
      const paths = byClass(svg, 'medge');
      const lines = paths.filter((p) => p.classList.contains('mpline'));
      const arrows = paths.filter((p) => !p.classList.contains('mpline'));
      assert.strictEqual(arrows.length, 2, 'Spec to Build and Build to Test');
      assert.ok(arrows.every((p) => p.attrs['marker-end'] === 'url(#map-arrow)'));
      assert.strictEqual(lines.length, 2);
      assert.ok(lines.every((p) => p.attrs['marker-end'] === 'url(#map-parent-dot)'));
    });
  });

  test('a parent on another board is one stub, and each of its children has a line to it', () => {
    open([
      [40, 'todo', 'Abroad', { parent: '"fpp#4"' }],
      [41, 'todo', 'Abroad too', { parent: '"fpp#4"' }],
    ], (page, view) => {
      const [svg] = graphs(view);
      const stubs = nodesOf(svg).filter((g) => g.classList.contains('ghost'));
      assert.deepStrictEqual(stubs.map(labelOf), ['fpp#4']);
      assert.strictEqual(stubs[0].dataset.mapnode, undefined, 'a stub opens nothing');
      assert.deepStrictEqual(parentLines(page, svg), ['40>fpp#4', '41>fpp#4']);
    });
  });
});

describe('trees', () => {
  const TWO_TREES = FAMILY.concat([
    [30, 'todo', 'Other root'],
    [31, 'doing', 'Other child', { parent: 30 }],
  ]);

  test('each tree is its own graph under a heading with its root titles and card count, the biggest first', () => {
    open(TWO_TREES, (page, view) => {
      const found = graphs(view);
      assert.strictEqual(found.length, 2);
      assert.deepStrictEqual(found.map((svg) => nodesOf(svg).map(labelOf).sort()), [['#1', '#2', '#3', '#4', '#5'], ['#30', '#31']]);
      const headings = text(view, 'map-graph-heading');
      assert.strictEqual(headings.length, 2);
      assert.ok(headings[0].includes('#1 Ship') && headings[0].includes('5 cards'), headings[0]);
      assert.ok(headings[1].includes('#30 Other root') && headings[1].includes('2 cards'), headings[1]);
    });
  });

  test('the section says how many trees and cards, and each graph scrolls on its own', () => {
    open(TWO_TREES, (page, view) => {
      assert.deepStrictEqual(text(view, 'map-title'), ['Relation trees (2 trees, 7 cards)']);
      assert.strictEqual(byClass(view, 'hnav').length, 2);
    });
  });

  test('a card that waits on a card in another tree joins that tree\'s graph', () => {
    open(TWO_TREES.concat([[32, 'todo', 'Bridge', { waiting_for: '[4]', parent: 30 }]]), (page, view) => {
      assert.strictEqual(graphs(view).length, 1);
    });
  });
});

describe('No relations', () => {
  test('a card with no dependency, parent or children is in a row of its own, and a card with only a parent is not', () => {
    open(FAMILY.concat([[20, 'todo', 'Loose']]), (page, view) => {
      assert.deepStrictEqual(text(view, 'map-title'), ['Relation trees (1 tree, 5 cards)', 'No relations (1)']);
      const chips = byClass(view, 'mapiso');
      assert.deepStrictEqual(chips.map((c) => c.dataset.mapnode), ['20']);
      assert.ok(!graphs(view).some((svg) => nodesOf(svg).some((g) => labelOf(g) === '#20')));
    });
  });

  test('a board of loose cards has the row and no graph, and the old section names are gone', () => {
    open([[20, 'todo', 'Loose'], [21, 'todo', 'Loose too']], (page, view) => {
      assert.strictEqual(graphs(view).length, 0);
      assert.deepStrictEqual(text(view, 'map-title'), ['No relations (2)']);
      const all = view.all().map((n) => n.textContent).join(' ');
      assert.ok(!/No dependencies|Dependency graph/.test(all));
    });
  });

  test('a card with only a parent is in a graph, not in the row', () => {
    open([[1, 'todo', 'Root'], [2, 'todo', 'Kid', { parent: 1 }]], (page, view) => {
      assert.strictEqual(byClass(view, 'mapiso').length, 0);
      assert.strictEqual(graphs(view).length, 1);
    });
  });
});

describe('rows', () => {
  const MIXED = [
    [60, 'backlog', 'Root'],
    [61, 'done', 'Finished', { parent: 60 }],
    [62, 'backlog', 'Waiting', { parent: 60 }],
    [63, 'doing', 'Underway', { parent: 60 }],
    [64, 'todo', 'Next', { parent: 60 }],
  ];

  test('a row reads doing, todo, backlog, done from the left, whatever the card numbers', () => {
    open(MIXED, (page, view) => {
      const [svg] = graphs(view);
      const row = boxes(page, svg).filter((b) => b.label !== '#60').sort((a, b) => a.x - b.x).map((b) => b.label);
      assert.deepStrictEqual(row, ['#63', '#64', '#62', '#61']);
    });
  });

  test('archived children read after done', () => {
    open(MIXED, (page) => {
      page.run('statusVis.archive=true');
      const [svg] = graphs(redraw(page));
      const row = boxes(page, svg).filter((b) => b.label !== '#60').sort((a, b) => a.x - b.x).map((b) => b.label);
      assert.deepStrictEqual(row, ['#63', '#64', '#62', '#61', '#65']);
    }, [[65, 'done', 'Old', { parent: 60 }]]);
  });

  test('a stub for a hidden child reads last', () => {
    open(MIXED, (page) => {
      page.run('statusVis.todo=false');
      const [svg] = graphs(redraw(page));
      const row = boxes(page, svg).filter((b) => b.label !== '#60').sort((a, b) => a.x - b.x).map((b) => b.label);
      assert.deepStrictEqual(row, ['#63', '#62', '#61', '#64']);
    });
  });

  test('a row sits in the middle of the widest row, and so does each graph', () => {
    open(MIXED, (page, view) => {
      const [svg] = graphs(view);
      const all = boxes(page, svg);
      const centre = (list) => (Math.min(...list.map((b) => b.x)) + Math.max(...list.map((b) => b.x + b.w))) / 2;
      const children = all.filter((b) => b.label !== '#60');
      const parent = all.filter((b) => b.label === '#60');
      assert.strictEqual(centre(parent), centre(children));
      assert.ok(view.classList.contains('map-align-center'), 'the page centres each graph');
    });
  });
});

describe('rich cards', () => {
  const RICH = [
    [1, 'doing', 'Ship', { type: 'epic' }],
    [2, 'done', 'Build', { parent: 1 }],
    [3, 'todo', 'Test', { parent: 1, type: 'epic' }],
  ];
  const nodeLabelled = (svg, label) => nodesOf(svg).find((g) => labelOf(g) === label);

  test('a card with a type wears its chip, a parent its altitude badge and a roll-up bar of its leaves', () => {
    open(RICH, (page, view) => {
      const [svg] = graphs(view);
      const top = nodeLabelled(svg, '#1');
      assert.deepStrictEqual(text(top, 'type-chip'), ['epic']);
      assert.deepStrictEqual(text(top, 'alt-badge'), ['▲1']);
      assert.strictEqual(byClass(top, 'rollup-seg').length > 0, true, 'the bar has a segment per status');
      assert.ok(byClass(top, 'rollup-bar')[0].classList.contains('thin'));
      const leaf = nodeLabelled(svg, '#2');
      assert.strictEqual(byClass(leaf, 'type-chip').length + byClass(leaf, 'alt-badge').length + byClass(leaf, 'rollup-bar').length, 0);
    });
  });

  test('a card with nothing to add is the shortest node, and one with a bar the tallest', () => {
    open(RICH, (page, view) => {
      const [svg] = graphs(view);
      const height = (label) => boxFor(page, svg, label).h;
      assert.ok(height('#2') < height('#3'), 'a chip makes a node taller');
      assert.ok(height('#3') < height('#1'), 'a bar makes it taller still');
    });
  });

  test('tapping a node, its chip or its bar opens the card', () => {
    open(RICH, (page, view) => {
      const [svg] = graphs(view);
      const top = nodeLabelled(svg, '#1');
      for (const target of [top, byClass(top, 'type-chip')[0], byClass(top, 'rollup-seg')[0]]) {
        page.byId('modalscroll').replaceChildren();
        page.click(target);
        assert.strictEqual(byClass(page.byId('modalscroll'), 'ttl')[0].textContent, 'Ship');
      }
    });
  });

  test('the roll-up counts the board as snapshotted, not what is queued', () => {
    open(RICH, (page) => {
      page.run('queue({op:"edit",id:"2",fm:{parent:""}});render()');
      const [svg] = graphs(redraw(page));
      const top = nodeLabelled(svg, '#1');
      assert.ok(byClass(top, 'rollup-seg').some((s) => s.title.startsWith('done')), 'card 2 is still under card 1 in the map');
    });
  });
});

describe('blocked and waiting cards', () => {
  const STUCK = [
    [71, 'todo', 'Top'],
    [70, 'todo', 'Stuck', { parent: 71, blocked: 'vendor', type: 'epic' }],
    [72, 'todo', 'Fine', { parent: 71 }],
    [73, 'todo', 'Later', { parent: 71, waiting_for: '[72]' }],
    [74, 'todo', 'Bare', { parent: 71, blocked: 'true' }],
  ];

  test('a blocked card wears the red pill to the left of its chip, in a node made tall enough for it', () => {
    open(STUCK, (page, view) => {
      const [svg] = graphs(view);
      const stuck = nodesOf(svg).find((g) => labelOf(g) === '#70');
      const fine = nodesOf(svg).find((g) => labelOf(g) === '#72');
      assert.ok(stuck.classList.contains('blocked'));
      const pill = byClass(stuck, 'mblk')[0];
      assert.deepStrictEqual(text(stuck, 'mblkt'), ['blocked']);
      const chipBox = stuck.children.find((c) => c.tagName === 'FOREIGNOBJECT');
      assert.ok(Number(chipBox.attrs.x) >= Number(pill.attrs.x) + Number(pill.attrs.width), 'the chip starts after the pill');
      assert.strictEqual(byClass(fine, 'mblk').length, 0);
      assert.ok(boxFor(page, svg, '#70').h > boxFor(page, svg, '#72').h);
      assert.ok(boxFor(page, svg, '#74').h > boxFor(page, svg, '#72').h, 'a blocked card with no chip still has room for the pill');
    });
  });

  test('a card waiting on one that is not done is outlined as waiting, and a card waiting on nothing is not', () => {
    open(STUCK, (page, view) => {
      const [svg] = graphs(view);
      const classes = Object.fromEntries(nodesOf(svg).map((g) => [labelOf(g), g.classList.contains('waiting')]));
      assert.strictEqual(classes['#73'], true);
      assert.strictEqual(classes['#72'], false);
    });
  });
});

describe('what the filters hide', () => {
  test('a hidden child is a dimmed stub on its visible parent, and shows as a card once its status is shown', () => {
    open(FAMILY, (page) => {
      page.run('statusVis.done=false');
      let [svg] = graphs(redraw(page));
      assert.deepStrictEqual(nodesOf(svg).filter((g) => g.classList.contains('ghost')).map(labelOf).sort(), ['#2', '#3']);
      page.run('statusVis.done=true');
      [svg] = graphs(redraw(page));
      assert.strictEqual(nodesOf(svg).filter((g) => g.classList.contains('ghost')).length, 0);
    });
  });

  test('with every status hidden the map says there is nothing to show', () => {
    open(FAMILY, (page) => {
      page.run('["backlog","todo","doing","done"].forEach(k=>{statusVis[k]=false})');
      const view = redraw(page);
      assert.deepStrictEqual(text(view, 'map-empty'), ['No cards to show.']);
      assert.strictEqual(graphs(view).length, 0);
    });
  });
});
