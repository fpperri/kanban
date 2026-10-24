const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { nextHighlightIndex } = require('../../plugin/skills/web/web/combobox');
const { keyGuardTyping } = require('../../plugin/skills/web/web/key-guard');
const { sliceKeyIsChord } = require('../../plugin/skills/web/web/slice-run');
const { withBuiltBoard } = require('./search-table');
const { openPanel } = require('./panel-table');

// The panel's text and its keys are the web's, and where the page cannot embed a piece it holds a copy
// of what the web says, so a copy that drifts fails here. The key guard's typing check, the run of
// slices' chord rule and the combobox's highlight step are embedded as the web's own source
// (search-embed.test.js holds that); the hint texts are strings of the web's page scripts, which
// need a DOM and are not embedded, so the page's copy of each is read against the source.

const web = (file) => fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', file), 'utf8').replace(/\r\n/g, '\n');
const constant = (source, name) => {
  const m = new RegExp(`const ${name} = '([^']*)';`).exec(source);
  assert.ok(m, `${name} is a string constant in the web source`);
  return m[1];
};

test('the page\'s hint and switch texts are the web\'s, to the character', () => {
  const panel = web('search-panel.js');
  const slices = web('search-slices.js');
  withBuiltBoard('plan', (page) => {
    assert.strictEqual(page.run('PILL_HINT'), constant(panel, 'SEARCH_PILL_HINT'));
    assert.strictEqual(page.run('SLICE_HINT'), constant(slices, 'SEARCH_SLICES_HINT'));
    assert.strictEqual(page.run('SWITCH_ON'), constant(panel, 'SEARCH_SWITCH_ON'));
    assert.strictEqual(page.run('SWITCH_OFF'), constant(panel, 'SEARCH_SWITCH_OFF'));
  });
});

test('the arrow\'s title in the markup, before the page script has run, is the switch\'s text for on', () => {
  withBuiltBoard('plan', (page, dir, html) => {
    const tag = /<button[^>]*id="search-panel-toggle"[^>]*>/.exec(html)[0];
    const title = /title="([^"]*)"/.exec(tag)[1];
    assert.strictEqual(title, constant(web('search-panel.js'), 'SEARCH_SWITCH_ON'));
    assert.strictEqual(title, page.run('SWITCH_ON'));
    const appHtml = web('app.html');
    assert.ok(appHtml.includes(`title="${title}"`), 'and the web\'s own markup says the same');
  });
});

test('the page\'s keys read the web\'s key guard and chord rule, the one source each', () => {
  withBuiltBoard('plan', (page) => {
    const lf = (fn) => fn.toString().replace(/\r\n/g, '\n');
    assert.strictEqual(page.run('keyGuardTyping.toString()'), lf(keyGuardTyping));
    assert.strictEqual(page.run('sliceKeyIsChord.toString()'), lf(sliceKeyIsChord));
    assert.strictEqual(page.run('nextHighlightIndex.toString()'), lf(nextHighlightIndex));
  });
});

test('a field with focus puts the slice keys and p off, the same fields the web guard names', () => {
  const fields = [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true },
    { tagName: 'BUTTON' }, { tagName: 'DIV' }, null,
  ];
  withBuiltBoard('plan', (page) => {
    openPanel(page);
    const doc = page.byId('q').ownerDocument;
    for (const active of fields) {
      doc.activeElement = active;
      const typing = keyGuardTyping({ activeElement: active });
      assert.strictEqual(page.run('keysOff()'), typing, JSON.stringify(active));
    }
  });
});
