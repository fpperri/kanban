const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sliceCards } = require('../../web/web/slices');
const { depthMap } = require('../../web/web/nesting');
const { parseSearchQuery, searchSetSlice } = require('../../web/web/search');
const { sliceListOf, sliceRunClick, sliceRunKeep, sliceRunOf, sliceRunValue } = require('../../web/web/slice-run');
const { byClass } = require('./page-harness');
const { board: smallBoard, open, tile } = require('./nesting-view');
const { planCards, shownIds, webContext, withBuiltBoard } = require('./search-table');
const { blurBox, boxEl, boxText, entry, openPanel, pill, sliceEntries } = require('./panel-table');

// The search panel's slice section on the snapshot page: the slices it lists with their
// icons and counts, the run it shows as pressed, what a click, a right-click, the
// context-menu key and Shift+F10 do to the box, and the keys [ ] { }. The slice: term it
// writes is what the web writes for the same run, and the counts are the web's own slice list
// over the same cards. Each test builds a board of the browser runner (plan, fixture or
// malformed) or a small one, opens the panel by putting the cursor in the box, and does what
// a person does.

const MOUSE = { matchMedia: (q) => q.includes('min-width:900px') || q.includes('pointer: fine') };
const labels = (page) => sliceEntries(page).map((s) => s.label);
const counts = (page) => Object.fromEntries(sliceEntries(page).map((s) => [s.label, s.count]));
const inRun = (page) => sliceEntries(page).filter((s) => s.inRun).map((s) => s.label);
const statusPill = (page, status) => byClass(page.byId('boardpills'), 'pillrow')[0].children.find((b) => b.dataset.st === status);
// The context-menu key on an entry keeps only that slice, as a right-click does, and needs no mouse.
const keepOnly = (page, label) => page.key(entry(page, label).el, 'ContextMenu');
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const without = (ids, gone) => ids.filter((id) => !gone.includes(id));
const LIVE = [...range(1, 18), ...range(22, 29)];

// Every slice the plan board's axis has: its four tiers with the glyph each type wears, then
// the depths, written out from the board's cards, the three archived ones left out.
const PLAN = [
  ['goal', '★', 2],
  ['strategy', '⬢', 2],
  ['objective', '◆', 1],
  ['epic', '■', 1],
  ['depth 0', '', 13],
  ['depth 1', '', 4],
  ['depth 2', '', 1],
  ['depth 3', '', 0],
  ['depth 4', '', 1],
  ['depth 5', '', 1],
];

// What the web's slice list says for a board as built, over the cards the status pills leave.
function webList(dir, { archive = false, hide = [] } = {}) {
  const all = planCards(dir);
  const ctx = webContext(dir);
  const sliced = sliceCards(all, ctx.hierarchy, depthMap(all, ctx));
  const shown = all.filter((c) => (c.archived ? archive : !hide.includes(c.status))).map((c) => c.id);
  return sliceListOf(sliced, shown).map((e) => [e.label, e.count]);
}

describe('the slice section lists the board\'s slices', () => {
  test('plan board: the tiers the board uses with their icons, then the depths, each with its count', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.icon, s.count]), PLAN);
    });
  });

  test('every slice count is the web\'s slice list\'s count for the same board, with the Archive pill off and on, and with Done hidden', () => {
    withBuiltBoard('plan', (page, dir) => {
      openPanel(page);
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), webList(dir));
      page.click(statusPill(page, 'done'));
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), webList(dir, { hide: ['done'] }));
      page.click(statusPill(page, 'done'));
      page.click(statusPill(page, 'archive'));
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), webList(dir, { archive: true }));
    });
  });

  test('a tier no card is in is not listed, and the depths are', () => {
    const config = 'hierarchy: [goal, strategy, epic]\ntypes:\n  - name: goal\n    icon: star\n  - epic\n';
    open(smallBoard(config, [[1, 'todo', 'Top', { type: 'goal' }], [2, 'todo', 'Mid', { type: 'epic', parent: 1 }], [3, 'todo', 'Loose']]), (page) => {
      openPanel(page);
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.icon, s.count]), [['goal', '★', 1], ['epic', '', 1], ['depth 0', '', 1]]);
    });
  });

  test('a tier only an archived card is in is listed, with no count until the Archive pill is on', () => {
    const config = 'hierarchy: [goal, strategy]\n';
    open(smallBoard(config, [[1, 'todo', 'Top', { type: 'goal' }]], [[2, 'done', 'Old', { type: 'strategy' }]]), (page) => {
      openPanel(page);
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), [['goal', 1], ['strategy', 0]]);
      page.click(statusPill(page, 'archive'));
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), [['goal', 1], ['strategy', 1]]);
    });
  });

  test('a board with no hierarchy lists depths only', () => {
    withBuiltBoard('fixture', (page, dir) => {
      openPanel(page);
      assert.ok(labels(page).length > 0 && labels(page).every((l) => /^depth \d+$/.test(l)), labels(page).join());
      assert.strictEqual(labels(page)[0], 'depth 0');
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), webList(dir));
    });
  });

  test('a malformed board lists each tier once, as first written, with the depths after, and the page logs no error', () => {
    const logged = [];
    const record = (level) => (...args) => logged.push([level, ...args.map(String)]);
    const spy = { log: () => {}, info: () => {}, debug: () => {}, warn: record('warn'), error: record('error') };
    withBuiltBoard('malformed', (page, dir) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page).slice(0, 2), ['Goal', 'Epic']);
      assert.ok(labels(page).slice(2).every((l) => /^depth \d+$/.test(l)), labels(page).join());
      assert.deepStrictEqual(sliceEntries(page).map((s) => [s.label, s.count]), webList(dir));
      keepOnly(page, 'Epic');
      assert.strictEqual(boxText(page), 'slice:Epic');
    }, { console: spy });
    assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
  });

  test('every entry is a button of its own class, never a pill\'s, with an icon, a label and a count, and the icon is hidden from assistive technology', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      for (const s of sliceEntries(page)) {
        assert.strictEqual(s.el.tagName, 'BUTTON');
        assert.ok(!s.el.classList.contains('query-pill'), 'not a pill');
        assert.strictEqual(s.el.children.length, 3);
        assert.strictEqual(s.el.children[0].getAttribute('aria-hidden'), 'true');
      }
    });
  });

  test('the section starts folded and the pill section unfolded, and a fold control opens or closes its own section', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.ok(page.byId('search-slices').classList.contains('hidden'), 'slices folded');
      assert.strictEqual(page.byId('search-slices-fold').getAttribute('aria-expanded'), 'false');
      assert.ok(!page.byId('search-pills').classList.contains('hidden'), 'pills open');
      assert.strictEqual(page.byId('search-pills-fold').getAttribute('aria-expanded'), 'true');
      page.click(page.byId('search-slices-fold'));
      assert.ok(!page.byId('search-slices').classList.contains('hidden'));
      assert.strictEqual(page.byId('search-slices-fold').getAttribute('aria-expanded'), 'true');
      page.click(page.byId('search-pills-fold'));
      assert.ok(page.byId('search-pills').classList.contains('hidden'));
      assert.strictEqual(page.byId('search-pills-fold').getAttribute('aria-expanded'), 'false');
      assert.ok(!page.byId('search-slices').classList.contains('hidden'), 'the other section is left as it was');
    });
  });
});

describe('a click on a slice entry', () => {
  // The web's own slice-section scenario, step by step, on the same board: the term each gesture
  // writes and the cards the Board then shows.
  const STEPS = [
    ['click', 'goal', 'slice:strategy..', without(LIVE, [1, 25])],
    ['click', 'depth 5', 'slice:strategy..4', without(LIVE, [1, 25, 24])],
    ['click', 'goal', 'slice:..4', without(LIVE, [24])],
    ['click', 'objective', 'slice:..4', without(LIVE, [24])],
    ['keep', 'epic', 'slice:epic', [22]],
    ['click', 'epic', '', LIVE],
    ['keep', 'depth 1', 'slice:1', [3, 4, 5, 6]],
  ];

  test('writes the slice: term the web writes for the same run, step by step, and the board cuts to it', () => {
    withBuiltBoard('plan', (page, dir) => {
      openPanel(page);
      const ctx = webContext(dir);
      const all = planCards(dir);
      const sliced = sliceCards(all, ctx.hierarchy, depthMap(all, ctx));
      const list = sliceListOf(sliced, all.map((c) => c.id));
      const at = (label) => list.findIndex((e) => e.label === label);
      // What the web writes for the same gesture on the same box: its run arithmetic, then its term writer.
      const webWrites = (box, gesture, label) => {
        const values = parseSearchQuery(box, ctx.board).filter((t) => t.field === 'slice').map((t) => t.value);
        const run = sliceRunOf(sliced, list, values);
        return searchSetSlice(box, sliceRunValue(list, gesture === 'keep' ? sliceRunKeep(at(label)) : sliceRunClick(list, run, at(label))));
      };
      for (const [gesture, label, want, shows] of STEPS) {
        const webBox = webWrites(boxText(page), gesture, label);
        if (gesture === 'keep') page.contextmenu(entry(page, label).el);
        else page.click(entry(page, label).el);
        assert.strictEqual(boxText(page), want, `${gesture} ${label}`);
        assert.strictEqual(boxText(page), webBox, `${gesture} ${label}: what the web writes`);
        assert.deepStrictEqual(shownIds(page), shows, `${gesture} ${label}: the cards shown`);
      }
    }, MOUSE);
  });

  test('a click outside the run grows it, a click on an end drops that end, a click inside changes nothing, and a click on a run of one removes the cut', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.deepStrictEqual(inRun(page), PLAN.map((p) => p[0]), 'with no cut every entry is in the run');
      page.click(entry(page, 'epic').el);
      assert.strictEqual(boxText(page), '', 'a click inside the run, not on an end, on a board with no cut changes nothing');
      keepOnly(page, 'strategy');
      assert.strictEqual(boxText(page), 'slice:strategy');
      assert.deepStrictEqual(inRun(page), ['strategy']);
      page.click(entry(page, 'epic').el);
      assert.strictEqual(boxText(page), 'slice:strategy..epic');
      assert.deepStrictEqual(inRun(page), ['strategy', 'objective', 'epic']);
      page.click(entry(page, 'objective').el);
      assert.strictEqual(boxText(page), 'slice:strategy..epic', 'inside the run and not an end: nothing changes');
      page.click(entry(page, 'strategy').el);
      assert.strictEqual(boxText(page), 'slice:objective..epic');
      page.click(entry(page, 'objective').el);
      assert.strictEqual(boxText(page), 'slice:epic');
      page.click(entry(page, 'epic').el);
      assert.strictEqual(boxText(page), '');
      assert.deepStrictEqual(inRun(page), PLAN.map((p) => p[0]));
    });
  });

  test('a cut leaves every slice count and every pill count where it was', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const pillCounts = () => Object.fromEntries(byClass(page.byId('search-pills'), 'query-pill').map((el) => [el.children[0].textContent, el.children[1].textContent]));
      const sliceBefore = counts(page);
      const pillsBefore = pillCounts();
      keepOnly(page, 'epic');
      assert.deepStrictEqual(shownIds(page), [22]);
      assert.deepStrictEqual(counts(page), sliceBefore);
      assert.deepStrictEqual(pillCounts(), pillsBefore);
      page.click(entry(page, 'goal').el);
      assert.deepStrictEqual(shownIds(page), [1, 2, 7, 22, 25, 26], 'goal down to epic: the strategy and objective cards between them too');
      assert.deepStrictEqual(counts(page), sliceBefore);
    });
  });

  test('a pill turned on leaves the slice counts unchanged, and the run in the box stays when a pill is clicked', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const before = counts(page);
      keepOnly(page, 'epic');
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), 'review: slice:epic');
      assert.deepStrictEqual(counts(page), before);
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), 'slice:epic');
    });
  });

  test('a right-click keeps only that slice and the browser menu stays shut, and a coarse pointer keeps its own long-press menu', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      keepOnly(page, 'goal');
      page.click(entry(page, 'epic').el);
      assert.strictEqual(boxText(page), 'slice:..epic', 'the run reaches the top, so that end stays open');
      assert.strictEqual(page.contextmenu(entry(page, 'objective').el), true);
      assert.strictEqual(boxText(page), 'slice:objective');
      assert.deepStrictEqual(inRun(page), ['objective']);
    }, MOUSE);
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(page.contextmenu(entry(page, 'objective').el), false);
      assert.strictEqual(boxText(page), '');
    });
  });

  test('the context-menu key and Shift+F10 on an entry keep only that slice, and the browser menu stays shut', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(page.key(entry(page, 'epic').el, 'ContextMenu'), true);
      assert.strictEqual(boxText(page), 'slice:epic');
      assert.strictEqual(page.key(entry(page, 'strategy').el, 'F10', { shiftKey: true }), true);
      assert.strictEqual(boxText(page), 'slice:strategy');
      assert.strictEqual(page.key(entry(page, 'goal').el, 'F10'), false, 'F10 without Shift is not it');
      assert.strictEqual(page.key(entry(page, 'goal').el, 'F10', { shiftKey: true, ctrlKey: true }), false, 'nor is a chord');
      assert.strictEqual(boxText(page), 'slice:strategy');
      assert.strictEqual(page.key(page.byId('board'), 'ContextMenu'), false, 'off an entry the key is the browser\'s');
    });
  });

  test('typing a slice: term in the box shows as the run at once, and a name that cuts nothing shows every entry', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.type(page.byId('q'), 'slice:objective..epic');
      assert.deepStrictEqual(inRun(page), ['objective', 'epic']);
      page.type(page.byId('q'), 'slice:nosuch');
      assert.deepStrictEqual(inRun(page), PLAN.map((p) => p[0]));
    });
  });
});

describe('the keys [ ] { }', () => {
  const press = (page, key, mods) => { blurBox(page); return page.key(page.byId('board'), key, mods); };

  test('move the ends of the run, with the panel open or closed, and stop at the ends of the list', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      keepOnly(page, 'strategy');
      page.click(entry(page, 'epic').el);
      assert.strictEqual(boxText(page), 'slice:strategy..epic');
      assert.strictEqual(press(page, ']'), true, 'the browser has nothing to do with the key once the page moved the run');
      assert.strictEqual(boxText(page), 'slice:strategy..0');
      press(page, '[');
      assert.strictEqual(boxText(page), 'slice:strategy..epic');
      press(page, '{');
      assert.strictEqual(boxText(page), 'slice:..epic');
      press(page, '}');
      assert.strictEqual(boxText(page), 'slice:strategy..epic');
      for (let i = 0; i < 12; i++) press(page, ']');
      assert.strictEqual(boxText(page), 'slice:strategy..', 'down to the last slice, which reads as an open end');
      page.click(page.byId('search-panel-toggle'));
      assert.ok(page.byId('search-panel').classList.contains('hidden'), 'sanity: the panel is closed');
      press(page, '[');
      assert.strictEqual(boxText(page), 'slice:strategy..4', 'the run moves while the panel is closed too');
    });
  });

  test('with no slice: term in the box the run is every slice, and a key pulls an end of it in by one', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      press(page, '[');
      assert.strictEqual(boxText(page), 'slice:..4', '[ pulls the bottom of the run up by one');
      press(page, '}');
      assert.strictEqual(boxText(page), 'slice:strategy..4', '} pulls the top down by one');
    });
  });

  test('do nothing while the user types in the box', () => {
    withBuiltBoard('plan', (page) => {
      keepOnly(openPanel(page), 'epic');
      boxEl(page).focus();
      assert.strictEqual(page.key(boxEl(page), '['), false);
      assert.strictEqual(page.key(boxEl(page), '{'), false);
      assert.strictEqual(boxText(page), 'slice:epic');
    });
  });

  test('do nothing while a sheet is open or a card menu is open', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      keepOnly(page, 'epic');
      page.byId('board').focus();
      page.click(tile(page, 22));
      assert.strictEqual(page.byId('modal').style.display, '', 'sanity: the card sheet is up');
      assert.strictEqual(press(page, ']'), false);
      assert.strictEqual(boxText(page), 'slice:epic', 'a sheet');
      page.run('closeCard()');
      page.run('openCtxMenu(22, 10, 10)');
      assert.strictEqual(press(page, ']'), false);
      assert.strictEqual(boxText(page), 'slice:epic', 'a card menu');
      page.run('closeCtxMenu()');
      press(page, ']');
      assert.strictEqual(boxText(page), 'slice:epic..0', 'with all of them closed the key works again');
    });
  });

  test('a queued edit leaves the keys working: the change tray sits in the page, it is not a dialog', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      keepOnly(page, 'epic');
      page.byId('board').focus();
      page.run("queue({ op: 'move', id: 22, to: 'done' }); render();");
      assert.strictEqual(page.byId('pend').style.display, 'block', 'sanity: the change tray is up');
      assert.strictEqual(press(page, ']'), true);
      assert.strictEqual(boxText(page), 'slice:epic..0', 'a slice key with the tray up');
      assert.strictEqual(press(page, 'p'), true);
      assert.ok(page.byId('search-panel').classList.contains('hidden'), 'p flips the panel switch with the tray up');
    });
  });

  test('a field in the change tray keeps the keys off, as any field does', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      keepOnly(page, 'epic');
      page.run("queue({ op: 'move', id: 22, to: 'done' }); render();");
      const payload = page.byId('payload');
      payload.focus();
      assert.strictEqual(page.key(payload, ']'), false);
      assert.strictEqual(boxText(page), 'slice:epic', 'the tray textarea is a field');
    });
  });

  test('a chord is not them, and AltGr, which types the brackets on a layout that has none, is', () => {
    withBuiltBoard('plan', (page) => {
      keepOnly(openPanel(page), 'strategy');
      assert.strictEqual(press(page, ']', { ctrlKey: true }), false);
      assert.strictEqual(press(page, ']', { altKey: true }), false);
      assert.strictEqual(press(page, ']', { metaKey: true }), false);
      assert.strictEqual(boxText(page), 'slice:strategy');
      assert.strictEqual(press(page, ']', { ctrlKey: true, altKey: true, getModifierState: (k) => k === 'AltGraph' }), true);
      assert.strictEqual(boxText(page), 'slice:strategy..objective');
    });
  });
});

describe('a cut and the chip', () => {
  test('with one pill on and a cut, and the panel closed, the chip shows 2 and its accessible name says what is on', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      keepOnly(page, 'epic');
      const chip = page.byId('search-chip');
      assert.ok(chip.classList.contains('hidden'), 'with the panel open the chip is out');
      page.click(page.byId('search-panel-toggle'));
      assert.ok(page.byId('search-panel').classList.contains('hidden'), 'sanity: the arrow click closed the panel');
      assert.ok(!chip.classList.contains('hidden'));
      assert.strictEqual(chip.textContent, '2');
      assert.strictEqual(chip.getAttribute('aria-label'), '2 on: review, slice epic');
      assert.strictEqual(chip.title, '2 on: review, slice epic');
    });
  });

  test('with nothing on there is no chip, and a slice: term that cuts nothing is not counted', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(page.byId('search-panel-toggle'));
      assert.ok(page.byId('search-chip').classList.contains('hidden'));
      assert.strictEqual(page.byId('search-chip').textContent, '');
      page.type(page.byId('q'), 'slice:nosuch');
      assert.ok(page.byId('search-chip').classList.contains('hidden'));
      page.type(page.byId('q'), 'slice:..');
      assert.ok(page.byId('search-chip').classList.contains('hidden'));
      page.type(page.byId('q'), 'slice:goal..epic');
      assert.strictEqual(page.byId('search-chip').textContent, '1');
    });
  });
});

describe('an entry and a pill are named for a screen reader', () => {
  test('each slice entry\'s name states its label, its count and whether it is in the run', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const names = sliceEntries(page).map((s) => s.name);
      assert.deepStrictEqual(names.slice(0, 4), ['goal, 2 cards, in the run', 'strategy, 2 cards, in the run', 'objective, 1 card, in the run', 'epic, 1 card, in the run']);
      assert.strictEqual(names[7], 'depth 3, 0 cards, in the run');
      keepOnly(page, 'epic');
      assert.strictEqual(entry(page, 'epic').name, 'epic, 1 card, in the run');
      assert.strictEqual(entry(page, 'goal').name, 'goal, 2 cards, not in the run');
      assert.strictEqual(entry(page, 'epic').el.getAttribute('aria-pressed'), 'true');
      assert.strictEqual(entry(page, 'goal').el.getAttribute('aria-pressed'), 'false');
    });
  });

  test('each pill\'s name states its label and its count', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(pill(page, 'review').el.getAttribute('aria-label'), 'review, 1 card');
      assert.strictEqual(pill(page, 'waiting').el.getAttribute('aria-label'), 'waiting, 3 cards');
      assert.strictEqual(pill(page, 'assignee:@human').el.getAttribute('aria-label'), 'assignee:@human, 21 cards');
    });
  });
});
