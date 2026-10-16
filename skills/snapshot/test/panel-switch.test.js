const { test, describe } = require('node:test');
const assert = require('node:assert');
const { tile } = require('./nesting-view');
const { withBuiltBoard } = require('./search-table');
const { blurBox, boxEl, boxText, buildBar, entry, openPanel, pill, pills } = require('./panel-table');

// The search panel's switch and the ways the panel opens and closes on the snapshot page: the
// arrow at the end of the box (a switch, announced with aria-pressed), the box taking focus, the
// p key, Esc, and a press outside the search bar. What the pills and the slice section do once
// the panel is open is panel-pills.test.js and panel-slices.test.js; the markup is
// panel-markup.test.js.

const panelHidden = (page) => page.byId('search-panel').classList.contains('hidden');
const toggle = (page) => page.byId('search-panel-toggle');
const press = (page, key, mods) => { blurBox(page); return page.key(page.byId('board'), key, mods); };
const focusIs = (page, el) => page.byId('q').ownerDocument.activeElement === el;

describe('the panel opens when the box takes focus, while the switch is on', () => {
  test('a page opens with the panel closed, the switch on and no pill drawn', () => {
    withBuiltBoard('plan', (page) => {
      assert.ok(panelHidden(page));
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true');
      assert.strictEqual(toggle(page).getAttribute('aria-expanded'), 'false');
      assert.deepStrictEqual(pills(page), []);
    });
  });

  test('focusing the box opens the panel and the arrow says so; the pills are drawn', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.ok(!panelHidden(page));
      assert.strictEqual(toggle(page).getAttribute('aria-expanded'), 'true');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true');
      assert.ok(pills(page).length > 0);
    });
  });

  test('a click on the arrow switches it off: the panel closes, and focusing the box no longer opens it; a second click switches it on and opens the panel', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(toggle(page));
      assert.ok(panelHidden(page));
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false');
      assert.strictEqual(toggle(page).getAttribute('aria-expanded'), 'false');
      assert.match(toggle(page).title, /off/i);
      blurBox(page);
      openPanel(page);
      assert.ok(panelHidden(page), 'the switch is off: focus opens nothing');
      page.click(toggle(page));
      assert.ok(!panelHidden(page), 'switched on again, the panel opens now');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true');
      assert.match(toggle(page).title, /opens when the box is focused/i);
      blurBox(page);
      page.click(toggle(page));
      page.click(toggle(page));
      blurBox(page);
      openPanel(page);
      assert.ok(!panelHidden(page), 'and opens on focus again');
    });
  });

  test('the p key flips the same switch, off and on, and does nothing while typing, in a sheet, or as a chord, a capital with Shift or a held key', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      assert.strictEqual(press(page, 'p'), true);
      assert.ok(panelHidden(page));
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false');
      press(page, 'p');
      assert.ok(!panelHidden(page));
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true');
      press(page, 'P');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false', 'a capital P from Caps Lock is the key too');
      press(page, 'P', { shiftKey: true });
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false', 'Shift on the key is not it');
      for (const mods of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { repeat: true }]) {
        assert.strictEqual(press(page, 'p', mods), false);
        assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false');
      }
      boxEl(page).focus();
      assert.strictEqual(page.key(boxEl(page), 'p'), false, 'typing in the box');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false');
      blurBox(page);
      page.click(tile(page, 1));
      assert.strictEqual(press(page, 'p'), false, 'a card sheet is up');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'false');
    });
  });
});

describe('Esc and a press outside close the panel', () => {
  test('Esc closes an open panel, puts focus back on the arrow, keeps the box text and the switch, and the next focus opens it again', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      pill(page, 'review').el.focus();
      assert.strictEqual(page.key(page.byId('board'), 'Escape'), true, 'the page stops the browser\'s own Esc');
      assert.ok(panelHidden(page));
      assert.ok(focusIs(page, toggle(page)), 'focus goes to the arrow, since the pill that had it is hidden');
      assert.strictEqual(boxText(page), 'review:', 'the box keeps its text');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true', 'the switch is as it was');
      assert.strictEqual(page.key(page.byId('board'), 'Escape'), false, 'a closed panel leaves Esc alone');
      openPanel(page);
      assert.ok(!panelHidden(page));
    });
  });

  test('Esc pressed in the box closes the panel and leaves focus in the box, and the text stays', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.type(page.byId('q'), 'title:zephyr');
      assert.strictEqual(page.byId('qmenu').style.display, 'none', 'sanity: a scoped term offers no suggestions');
      assert.strictEqual(page.key(boxEl(page), 'Escape'), true);
      assert.ok(panelHidden(page));
      assert.ok(focusIs(page, boxEl(page)), 'focus stays in the box');
      assert.strictEqual(boxText(page), 'title:zephyr');
    });
  });

  test('Esc takes the suggestion list before the panel, and the panel before anything else', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.type(page.byId('q'), 'slice:');
      assert.strictEqual(page.byId('qmenu').style.display, '', 'sanity: the suggestions are up');
      assert.strictEqual(page.key(boxEl(page), 'Escape'), true);
      assert.strictEqual(page.byId('qmenu').style.display, 'none', 'the first Esc shuts the list');
      assert.ok(!panelHidden(page), 'and leaves the panel open');
      assert.strictEqual(page.key(boxEl(page), 'Escape'), true);
      assert.ok(panelHidden(page), 'the second shuts the panel');
      assert.strictEqual(boxText(page), 'slice:', 'the box keeps its text through both');
    });
  });

  test('Esc takes a card sheet before the panel', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(tile(page, 1));
      assert.strictEqual(page.byId('modal').style.display, '', 'sanity: the sheet is up');
      page.key(page.byId('board'), 'Escape');
      assert.strictEqual(page.byId('modal').style.display, 'none');
      assert.ok(!panelHidden(page), 'the panel is still open');
      page.key(page.byId('board'), 'Escape');
      assert.ok(panelHidden(page));
    });
  });

  test('a press outside the search bar closes the panel and leaves the switch as it was; a press inside it does not', () => {
    withBuiltBoard('plan', (page) => {
      buildBar(page);
      openPanel(page);
      page.mousedown(pill(page, 'review').el);
      page.mousedown(page.byId('q'));
      page.mousedown(page.byId('search-panel'));
      assert.ok(!panelHidden(page), 'inside the bar');
      page.mousedown(tile(page, 1));
      assert.ok(panelHidden(page), 'on a card');
      assert.strictEqual(toggle(page).getAttribute('aria-pressed'), 'true');
    });
  });
});

describe('the panel in use', () => {
  test('a pill that has focus keeps it through a click on it, so Tab goes on from where it was', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const review = pill(page, 'review').el;
      review.focus();
      page.click(review);
      assert.ok(pill(page, 'review').el === review, 'the same button after the board repainted');
      assert.ok(focusIs(page, review));
    });
  });

  test('with one pill on and the panel closed the chip shows 1 and its name names the pill; with the pill off again there is no chip', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'blocked').el);
      page.click(toggle(page));
      const chip = page.byId('search-chip');
      assert.ok(!chip.classList.contains('hidden'));
      assert.strictEqual(chip.textContent, '1');
      assert.strictEqual(chip.getAttribute('aria-label'), '1 on: blocked');
      page.click(toggle(page));
      page.click(pill(page, 'blocked').el);
      page.click(toggle(page));
      assert.ok(chip.classList.contains('hidden'));
      assert.strictEqual(chip.getAttribute('aria-label'), '');
    });
  });

  test('the board and the other views repaint when a pill writes the box, and a graph focus still overwrites it', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(pill(page, 'review').el);
      assert.strictEqual(page.run('qTerms.length'), 1, 'the page resolved the query again');
      page.run('graphFocus("tree", 3)');
      assert.strictEqual(boxText(page), 'tree:3');
      assert.strictEqual(pill(page, 'review').on, false, 'the box no longer holds the pill\'s query');
    });
  });

  test('every control of the panel is a button the browser\'s own Tab order reaches: no tab index, and Enter and Space are a click', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      page.click(page.byId('search-slices-fold'));
      const controls = [toggle(page), page.byId('search-slices-fold'), page.byId('search-pills-fold'), ...pills(page).map((p) => p.el),
        ...page.byId('search-slices').all().filter((n) => n.classList.contains('slice-entry'))];
      assert.ok(controls.length > 20);
      for (const el of controls) {
        assert.strictEqual(el.tagName, 'BUTTON');
        assert.strictEqual(el.getAttribute('tabindex'), null);
        assert.strictEqual(el.disabled, undefined);
      }
      for (const el of controls.filter((c) => !c.id)) assert.strictEqual(el.type, 'button', 'a button the page builds is no submit button');
    });
  });
});
