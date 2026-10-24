const { test, describe } = require('node:test');
const assert = require('node:assert');
const { pillList } = require('../../web/web/pills');
const { searchTermText } = require('../../web/web/search');
const { readConfig } = require('../../web/scripts/config-store');
const { byClass } = require('./page-harness');
const { board: smallBoard, open } = require('./nesting-view');
const { planCards, shownIds, webContext, webIds, webMatchIds, withBuiltBoard } = require('./search-table');
const { boxText, moreButton, openPanel, pill, pills } = require('./panel-table');

// The search panel's pill section on the snapshot page: the pills it lists (the three
// built-ins, the board's own, and one per value of a field:* entry), how they filter, and
// the counts they show, which are the web's own pill list over the same cards. Each test
// builds a board of the browser runner (plan, fixture or malformed), opens the panel by
// putting the cursor in the box, and does what a person does to the pills.

const labels = (page) => pills(page).map((p) => p.label);
// Opens the panel and the tag pills behind "+2 more", so that every pill the web lists has a button to read.
const openAll = (page) => { openPanel(page); page.click(moreButton(page)); };
const counts = (page) => Object.fromEntries(pills(page).map((p) => [p.label, p.count]));
const statusPill = (page, status) => byClass(page.byId('boardpills'), 'pillrow')[0].children.find((b) => b.dataset.st === status);

const MOUSE = { matchMedia: (q) => q.includes('min-width:900px') || q.includes('pointer: fine') };

const TAGS = ['api', 'data', 'docs', 'grill', 'grilling', 'infra', 'next-up', 'release', 'security', 'ui'];

// What the web's pill list says for a board as built, with the cards the status pills leave
// (every live card, or every card with the Archive pill on), matched by the web's own search.
function webCounts(dir, { archive = false, hide = [] } = {}) {
  const all = planCards(dir);
  const ctx = webContext(dir);
  const shown = all.filter((c) => (c.archived ? archive : !hide.includes(c.status)));
  const board = { pills: readConfig(dir).pills, cards: all.filter((c) => !c.archived), term: searchTermText };
  return Object.fromEntries(pillList(shown, (q) => webMatchIds(all, q, ctx), board).map((p) => [p.label, p.count]));
}

describe('the pill section lists what the web lists', () => {
  test('plan board: blocked, review and waiting come first, then the board\'s pills, then one pill per tag, eight of them', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page), ['blocked', 'review', 'waiting', 'next', 'assignee:@human', ...TAGS.slice(0, 8)]);
    });
  });

  test('plan board: the tag pills show eight and "+2 more", which reveals the rest and then folds them again', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const more = moreButton(page);
      assert.strictEqual(more.textContent, '+2 more');
      assert.strictEqual(more.getAttribute('aria-expanded'), 'false');
      page.click(more);
      assert.deepStrictEqual(labels(page).slice(5), TAGS);
      assert.strictEqual(moreButton(page), more, 'the button stays the one button');
      assert.strictEqual(more.textContent, 'fewer');
      assert.strictEqual(more.getAttribute('aria-expanded'), 'true');
      page.click(more);
      assert.deepStrictEqual(labels(page).slice(5), TAGS.slice(0, 8));
      assert.strictEqual(more.textContent, '+2 more');
    });
  });

  test('a pill is a button of its own class, never a status pill\'s, and its label and query reach the page as text', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      for (const p of pills(page)) {
        assert.strictEqual(p.el.tagName, 'BUTTON');
        assert.ok(!p.el.classList.contains('pillrow') && p.el.dataset.act === undefined, 'no status pill\'s hooks');
        assert.strictEqual(p.el.children.length, 2, 'a label and a count');
      }
      assert.strictEqual(pill(page, 'next').el.title.startsWith('tags:"next-up"'), true, 'the query shows on hover');
    });
  });

  test('a closed panel draws no pills', () => {
    withBuiltBoard('plan', (page) => {
      assert.deepStrictEqual(labels(page), []);
    });
  });
});

describe('a click on a pill', () => {
  test('the grill pill leaves the grill card and not the grilling card, and the box holds its query', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.deepStrictEqual(shownIds(page).filter((id) => [8, 13].includes(id)), [8, 13], 'sanity: both cards are on the board');
      page.click(pill(page, 'grill').el);
      assert.strictEqual(boxText(page), 'tags:"grill"');
      assert.deepStrictEqual(shownIds(page), [8]);
      assert.strictEqual(pill(page, 'grill').on, true);
      assert.strictEqual(pill(page, 'grill').el.getAttribute('aria-pressed'), 'true');
    });
  });

  test('writes its query in the box and leaves only its matches, as the web search finds them', () => {
    withBuiltBoard('plan', (page, dir) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), 'review:');
      assert.deepStrictEqual(shownIds(page), [10]);
      assert.deepStrictEqual(shownIds(page), webIds(planCards(dir).filter((c) => !c.archived), 'review:', webContext(dir)));
    });
  });

  test('clicking the only pill that is on again clears the box and brings the board back', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const before = shownIds(page);
      page.click(pill(page, 'review').el);
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), '');
      assert.strictEqual(pill(page, 'review').on, false);
      assert.deepStrictEqual(shownIds(page), before);
    });
  });

  test('a second pill joins the first as one more alternative, and a click on it takes it out again', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      page.click(pill(page, 'blocked').el);
      assert.strictEqual(boxText(page), 'review: | blocked:');
      assert.deepStrictEqual(shownIds(page), [9, 10]);
      page.click(pill(page, 'blocked').el);
      assert.strictEqual(boxText(page), 'review:');
      assert.deepStrictEqual(shownIds(page), [10]);
    });
  });

  test('the box\'s own text stays when a click takes the pill out', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.type(page.byId('q'), 'zephyr');
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), 'zephyr | review:');
      page.click(pill(page, 'review').el);
      assert.strictEqual(boxText(page), 'zephyr');
    });
  });

  test('a right-click keeps only that pill, and a right-click on the pill that is alone turns it off', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      page.click(pill(page, 'blocked').el);
      assert.strictEqual(page.contextmenu(pill(page, 'waiting').el), true, 'the browser menu stays shut on a pill');
      assert.strictEqual(boxText(page), 'waiting:');
      assert.deepStrictEqual(pills(page).filter((p) => p.on).map((p) => p.label), ['waiting']);
      page.contextmenu(pill(page, 'waiting').el);
      assert.strictEqual(boxText(page), '');
      assert.deepStrictEqual(pills(page).filter((p) => p.on), []);
    }, MOUSE);
  });

  test('two pills with one query are one filter: a click turns both on, and a right-click on either is the pill that is alone', () => {
    withBuiltBoard('plan', (page) => {
      openAll(page);
      const next = () => pill(page, 'next');
      const tag = () => pill(page, 'next-up');
      page.click(next().el);
      assert.strictEqual(boxText(page), 'tags:"next-up"');
      assert.deepStrictEqual([next().on, tag().on], [true, true], 'the board pill and the tag pill share tags:"next-up"');
      page.contextmenu(tag().el);
      assert.strictEqual(boxText(page), '', 'the other pill is no other filter, so the one right-clicked was alone and goes off');
      assert.deepStrictEqual([next().on, tag().on], [false, false]);
      page.click(tag().el);
      page.contextmenu(next().el);
      assert.strictEqual(boxText(page), '', 'and the other way round');
    }, MOUSE);
  });

  test('a right-click on one of two pills with one query keeps only their query when another pill is on', () => {
    withBuiltBoard('plan', (page) => {
      openAll(page);
      page.click(pill(page, 'review').el);
      page.click(pill(page, 'next').el);
      assert.strictEqual(boxText(page), 'review: | tags:"next-up"');
      page.contextmenu(pill(page, 'next-up').el);
      assert.strictEqual(boxText(page), 'tags:"next-up"', 'review is another filter, so the right-click makes the query the only one');
      assert.deepStrictEqual(pills(page).filter((q) => q.on).map((q) => q.label).sort(), ['next', 'next-up']);
    }, MOUSE);
  });

  test('a coarse pointer keeps its own long-press menu on a pill', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(page.contextmenu(pill(page, 'review').el), false);
      assert.strictEqual(boxText(page), '');
    });
  });

  test('typing in the box turns a pill off that the box no longer holds', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      page.type(page.byId('q'), 'zephyr');
      assert.strictEqual(pill(page, 'review').on, false);
    });
  });
});

describe('the counts', () => {
  test('every pill\'s count is the web pill list\'s count for the same board, with the Archive pill off and on', () => {
    withBuiltBoard('plan', (page, dir) => {
      openAll(page);
      assert.deepStrictEqual(counts(page), webCounts(dir));
      assert.strictEqual(counts(page).review, 1);
      assert.strictEqual(counts(page).grill, 1);
      page.click(statusPill(page, 'archive'));
      assert.deepStrictEqual(counts(page), webCounts(dir, { archive: true }));
      assert.ok(counts(page)['assignee:@human'] > webCounts(dir)['assignee:@human'], 'archived cards are counted once shown');
    });
  });

  test('turning one pill on leaves every other count where it was', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const before = counts(page);
      page.click(pill(page, 'review').el);
      assert.deepStrictEqual(counts(page), before);
      page.click(pill(page, 'grill').el);
      assert.deepStrictEqual(counts(page), before);
      page.type(page.byId('q'), 'title:zephyr');
      assert.deepStrictEqual(counts(page), before, 'a typed search leaves them too');
    });
  });

  test('hiding Done with its status pill takes done cards out of the counts, as the web\'s list over the other cards says', () => {
    withBuiltBoard('plan', (page, dir) => {
      openAll(page);
      const before = counts(page);
      page.click(statusPill(page, 'done'));
      const after = counts(page);
      assert.deepStrictEqual(after, webCounts(dir, { hide: ['done'] }));
      assert.strictEqual(before.docs, 2, 'sanity: a done card and a todo card are tagged docs');
      assert.strictEqual(after.docs, 1);
    });
  });

  test('a count changes in the button it is in, so a pill that has focus keeps it, and so do the pills around it', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const docs = pill(page, 'docs').el;
      const neighbours = pills(page).filter((p) => p.label !== 'api').map((p) => p.el);
      docs.focus();
      page.run("queue({ op: 'edit', id: 3, fm: { tags: 'docs' } }); render();");
      assert.strictEqual(pill(page, 'docs').count, 3, 'the count moved');
      assert.ok(pill(page, 'docs').el === docs, 'the same button');
      assert.ok(docs.ownerDocument.activeElement === docs, 'and it still has focus');
      assert.ok(!labels(page).includes('api'), 'a pill whose tag left the board is gone');
      assert.ok(pills(page).filter((p) => p.label !== 'api').slice(0, neighbours.length - 1).every((p, i) => neighbours.includes(p.el)), 'and the others are the buttons they were');
    });
  });

  test('a queued edit counts: a pill sees the cards as the page shows them', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(pill(page, 'review').count, 1);
      page.run("queue({ op: 'edit', id: 3, fm: { review: 'look' } }); render();");
      assert.strictEqual(pill(page, 'review').count, 2);
    });
  });
});

describe('a field:* entry', () => {
  test('gives one pill per value among the live cards only, so a tag only an archived card holds has none', () => {
    const board = smallBoard('pills:\n  - "tags:*"\n', [[1, 'todo', 'Live', { tags: '[new]' }]], [[2, 'done', 'Old', { tags: '[old]' }]]);
    open(board, (page) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page), ['blocked', 'review', 'waiting', 'new']);
    });
  });

  test('is a pill per value read as written, with a label and a query a person could have put in markup carried as text', () => {
    const board = smallBoard('pills:\n  - "<b>x</b>": \'title:"<i>"\'\n', [[1, 'todo', 'Live']]);
    open(board, (page) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page), ['blocked', 'review', 'waiting', '<b>x</b>']);
      assert.strictEqual(pill(page, '<b>x</b>').el.children[0].textContent, '<b>x</b>');
      assert.strictEqual(pill(page, '<b>x</b>').el.children[0].children.length, 0, 'a text node, never an element');
    });
  });
});

describe('a board that sets no pills of its own', () => {
  test('fixture board: the three built-ins, and no more button', () => {
    withBuiltBoard('fixture', (page) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page), ['blocked', 'review', 'waiting']);
      assert.strictEqual(moreButton(page), undefined);
    });
  });
});

describe('a malformed board', () => {
  test('shows the built-ins and only its valid pills, and logs no error', () => {
    const logged = [];
    const record = (level) => (...args) => logged.push([level, ...args.map(String)]);
    const spy = { log: () => {}, info: () => {}, debug: () => {}, warn: record('warn'), error: record('error') };
    withBuiltBoard('malformed', (page, dir) => {
      openPanel(page);
      assert.deepStrictEqual(labels(page), ['blocked', 'review', 'waiting', 'tags', 'assignee:@human']);
      assert.deepStrictEqual(counts(page), { blocked: 0, review: 0, waiting: 1, tags: 1, 'assignee:@human': 4 });
      assert.deepStrictEqual(counts(page), webCounts(dir));
      page.click(pill(page, 'tags').el);
      assert.strictEqual(boxText(page), 'grill');
    }, { console: spy });
    assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
  });
});
