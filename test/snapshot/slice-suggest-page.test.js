const { test, describe } = require('node:test');
const assert = require('node:assert');
const { searchSuggestionItems } = require('../../plugin/skills/web/web/search');
const { byClass } = require('./page-harness');
const { planCards, shownIds, webContext, withBoardPage } = require('./search-table');

// The snapshot's search box suggests what the web's does, from the same module: the
// page hands the embedded search module's searchSuggestionItems the text, the caret,
// the board's cards (archived ones included) and its context, and draws what comes
// back as a menu under the box. After `slice:` and after `..` that is the board's
// slices; picking one completes the term and the page cuts by it as it does a term
// typed by hand. Each test types into the page's box and reads the menu and the cards.

// The plan board's slices, tiers first: goal, strategy, objective, epic, then the depths
// 0 and 1, the deepest card with no tier (card 24 is one untiered parent below the epic 22).
const PLAN_SLICES = ['goal', 'strategy', 'objective', 'epic', '0', '1'];

const menu = (page) => page.byId('qmenu');
const rows = (page) => byClass(menu(page), 'qitem');
const labels = (page) => rows(page).map((r) => r.textContent);
const open = (page) => menu(page).style.display !== 'none' && rows(page).length > 0;
const mousedown = (row) => {
  let prevented = false;
  for (const fn of row.listeners.mousedown || []) fn({ target: row, preventDefault() { prevented = true; } });
  return prevented;
};
const pick = (page, label) => mousedown(rows(page).find((r) => r.textContent === label));
const typeAt = (page, text, caret) => {
  const box = page.byId('q');
  box.selectionStart = caret === undefined ? text.length : caret;
  page.type(box, text);
};
const keyIn = (box, key) => {
  let prevented = false;
  let stopped = false;
  for (const fn of box.listeners.keydown || []) fn({ key, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  return { prevented, stopped };
};
const highlighted = (page) => rows(page).filter((r) => r.classList.contains('on')).map((r) => r.textContent);

describe('after slice: and after .., the menu lists the board\'s slices', () => {
  test('slice: lists the tiers in hierarchy order, then the depths down to the deepest card with no tier, the list the web\'s module gives', () => {
    withBoardPage('plan', (page, dir) => {
      typeAt(page, 'slice:');
      assert.deepStrictEqual(labels(page), PLAN_SLICES.map((s) => `slice:${s}`));
      assert.ok(open(page));
      const web = searchSuggestionItems('slice:', 6, planCards(dir), webContext(dir)).map((i) => i.label);
      assert.deepStrictEqual(labels(page), web, 'the page and the web say the same');
    });
  });

  test('after the dots the menu lists them again, each as the second end of the cut', () => {
    withBoardPage('plan', (page, dir) => {
      typeAt(page, 'slice:goal..');
      assert.deepStrictEqual(labels(page), PLAN_SLICES.map((s) => `slice:goal..${s}`));
      typeAt(page, 'tags:next-up slice:goal..e');
      assert.deepStrictEqual(labels(page), ['slice:goal..epic']);
      const web = searchSuggestionItems('tags:next-up slice:goal..e', 26, planCards(dir), webContext(dir)).map((i) => i.label);
      assert.deepStrictEqual(labels(page), web);
    });
  });

  test('the menu follows what is typed, and shuts when there is nothing to complete', () => {
    withBoardPage('plan', (page) => {
      typeAt(page, 'slice:o');
      assert.deepStrictEqual(labels(page), ['slice:objective']);
      typeAt(page, 'slice:objective');
      assert.ok(!open(page), 'a slice typed in full completes nothing more');
      assert.strictEqual(menu(page).style.display, 'none');
      typeAt(page, 'slice:zzz');
      assert.ok(!open(page));
      typeAt(page, '');
      assert.ok(!open(page), 'an empty box offers nothing');
    });
  });

  test('a token that is not a slice: opens no menu here, though the module offers scopes for a bare word, so a word typed on a phone never covers the panel', () => {
    withBoardPage('plan', (page, dir) => {
      assert.ok(searchSuggestionItems('sta', 3, planCards(dir), webContext(dir)).length > 1, 'sanity: the module has scopes to offer for a bare word');
      typeAt(page, 'sta');
      assert.ok(!open(page));
      assert.strictEqual(menu(page).style.display, 'none');
      typeAt(page, 'tags:next-up sta');
      assert.ok(!open(page));
      typeAt(page, 'slice:goal sta');
      assert.ok(!open(page), 'a slice: term elsewhere in the box does not open it for the word');
      typeAt(page, 'sta slice:');
      assert.deepStrictEqual(labels(page), PLAN_SLICES.map((s) => `slice:${s}`), 'the slice: token under the caret still does');
    });
  });
});

describe('picking a suggestion completes the term', () => {
  test('picking a tier writes slice:<tier> in the box and the page shows that slice\'s cards, the menu shut', () => {
    withBoardPage('plan', (page) => {
      typeAt(page, 'slice:');
      pick(page, 'slice:strategy');
      assert.strictEqual(page.byId('q').value, 'slice:strategy');
      assert.ok(!open(page));
      assert.deepStrictEqual(shownIds(page), [2, 26]);
    });
  });

  test('picking the end of a cut writes the whole cut and the page shows it, and picking a depth does the same', () => {
    withBoardPage('plan', (page) => {
      typeAt(page, 'slice:goal..');
      pick(page, 'slice:goal..objective');
      assert.strictEqual(page.byId('q').value, 'slice:goal..objective');
      assert.deepStrictEqual(shownIds(page), [1, 2, 7, 25, 26]);
      typeAt(page, 'slice:');
      pick(page, 'slice:1');
      assert.strictEqual(page.byId('q').value, 'slice:1');
      assert.deepStrictEqual(shownIds(page), [24]);
    });
  });

  test('a pick keeps what stands around the token, and the press is not allowed to take the focus from the box', () => {
    withBoardPage('plan', (page) => {
      typeAt(page, 'tags:next-up slice:e');
      assert.deepStrictEqual(labels(page), ['slice:epic']);
      assert.ok(pick(page, 'slice:epic'), 'the press is kept from blurring the box');
      assert.strictEqual(page.byId('q').value, 'tags:next-up slice:epic');
      assert.deepStrictEqual(shownIds(page), [], 'the cards the term and the tag both keep: none of them is in the epic tier');
    });
  });
});

describe('the menu is the box\'s own', () => {
  test('Escape in the box shuts the menu and goes no further, and a box that loses focus shuts it', () => {
    withBoardPage('plan', (page) => {
      const box = page.byId('q');
      typeAt(page, 'slice:');
      assert.ok(open(page));
      const esc = keyIn(box, 'Escape');
      assert.ok(!open(page));
      assert.ok(esc.stopped, 'that Escape is the menu\'s');
      assert.deepStrictEqual(keyIn(box, 'Escape'), { prevented: false, stopped: false }, 'with the menu shut it is not');
      typeAt(page, 'slice:');
      assert.ok(open(page));
      for (const fn of box.listeners.blur || []) fn({});
      assert.ok(!open(page));
    });
  });

  test('the arrow keys move a highlight down the rows, Enter picks the one it is on, and Enter with the menu shut is not the menu\'s', () => {
    withBoardPage('plan', (page) => {
      const box = page.byId('q');
      typeAt(page, 'slice:');
      assert.deepStrictEqual(highlighted(page), []);
      assert.ok(keyIn(box, 'ArrowDown').prevented);
      assert.ok(keyIn(box, 'ArrowDown').prevented);
      assert.deepStrictEqual(highlighted(page), ['slice:strategy'], 'the first Down is the first row, the second the next');
      keyIn(box, 'ArrowUp');
      assert.deepStrictEqual(highlighted(page), ['slice:goal']);
      keyIn(box, 'ArrowUp');
      assert.deepStrictEqual(highlighted(page), ['slice:1'], 'Up from the first row wraps to the last');
      keyIn(box, 'ArrowDown');
      assert.ok(keyIn(box, 'Enter').prevented);
      assert.strictEqual(box.value, 'slice:goal');
      assert.ok(!open(page));
      assert.strictEqual(keyIn(box, 'Enter').prevented, false);
    });
  });

  test('the menu opens when the box takes the focus with a token to complete in it', () => {
    withBoardPage('plan', (page) => {
      const box = page.byId('q');
      box.value = 'slice:';
      for (const fn of box.listeners.focus || []) fn({});
      assert.deepStrictEqual(labels(page), PLAN_SLICES.map((s) => `slice:${s}`));
    });
  });
});

describe('a board that declares no hierarchy, and a malformed one', () => {
  test('a board with no hierarchy suggests its depths', () => {
    withBoardPage('fixture', (page) => {
      typeAt(page, 'slice:');
      assert.deepStrictEqual(labels(page), ['slice:0', 'slice:1', 'slice:2']);
    });
  });

  test('a board whose hierarchy lists a tier twice and a blank entry suggests each tier once, as first written, and the page logs no error', () => {
    const logged = [];
    const record = (level) => (...args) => logged.push([level, ...args.map(String)]);
    const spy = { log: () => {}, info: () => {}, debug: () => {}, warn: record('warn'), error: record('error') };
    withBoardPage('malformed', (page) => {
      typeAt(page, 'slice:');
      assert.deepStrictEqual(labels(page), ['slice:Goal', 'slice:Epic', 'slice:0']);
      for (const text of ['slice:"', 'slice:..', 'slice:"Goal..', '(slice:', 'slice:|']) assert.doesNotThrow(() => typeAt(page, text), text);
    }, { console: spy });
    assert.deepStrictEqual(logged, []);
  });
});
