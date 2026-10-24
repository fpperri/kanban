const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Space takes the hover: Space on a hovered, else focused, card writes the sets On hover show ticks into the search
// box, Shift+Space adds them, and Ctrl+Space is the key that selects the focused card in the Graph. The docs say so,
// and the words that said Space selects are banned.

const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const webDoc = read('docs', 'web.md');
const webSkill = read('skills', 'web', 'SKILL.md');
const bullet = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from > -1, start);
  return text.slice(from, text.indexOf(end, from));
};

test('docs/web.md says what Space writes, that it never turns isolate on, and what Shift+Space adds', () => {
  const text = bullet(webDoc, '**Space takes the hover.**', '**Slice section**');
  assert.match(text, /With a card hovered, else focused, `Space` writes the sets \*On hover show\* ticks for it into the search box as alternatives \(`dlinks:12 \| hlinks:12`\), the box's run of slices kept and isolate as it was/);
  assert.match(text, /Unlike typing, that write never turns isolate on/);
  assert.match(text, /`Shift\+Space` adds that text to what the box holds as one more alternative, so a set can be built from several cards; an empty box takes it as a plain `Space` does/);
});

test('docs/web.md says Space on a hovered line writes the cards the line lights, and Shift+Space adds them', () => {
  const text = bullet(webDoc, '**Space takes the hover.**', '**Slice section**');
  assert.match(text, /In the Graph, with no card hovered or focused, `Space` on a hovered line writes the cards that line lights as card terms, `#176 \| #50`: a parent line its parent and its child, a dependency the card waited for and the card that waits, a bracket its parent and its children in the order it draws them; `Shift\+Space` adds them, and the sets ticked make no difference/);
  assert.match(webSkill.replace(/\s+/g, ' '), /With no such card, the line the pointer is on in the Graph supplies the text instead \(`graphHoverLineTerms`, `graph-view\.js`\): the cards it lights as card terms joined by ` \| ` \(`#176 \| #50`\), the parent or the card waited for first, a bracket's children in the order it draws them, whatever sets are ticked; a poll drops the line hover, so Space then does nothing new/);
});

test('docs/web.md says where Space keeps its own job, and that Ctrl+Space is the selecting key', () => {
  const text = bullet(webDoc, '**Space takes the hover.**', '**Slice section**');
  assert.match(text, /With no card hovered or focused, in a text field, on a button, link or switch, and behind a menu, a dialog, the notifications panel, the preferences sheet or the notes palette, `Space` keeps its own job: it scrolls, presses the button, or ticks a todo item/);
  assert.match(text, /`Ctrl\+Space` selects the focused card in the Graph, as a click does: it is the key `Space` was before/);
});

test('the Hotkeys paragraph of both docs names Space, Shift+Space and Ctrl+Space', () => {
  for (const [where, text] of [['docs/web.md', webDoc], ['the web skill', webSkill]]) {
    assert.match(text, /`Enter`, `Space`, `Shift\+Space`, `Ctrl\+Space`, `Ctrl\/Cmd\+S`/, where);
  }
});

test('the Graph paragraphs of both docs say Ctrl+Space is the key that acts on a dot or a lane header', () => {
  assert.match(webDoc, /double-click, Enter, Ctrl\+Space, hovering and focus act on it as on the card's dot/);
  assert.match(webSkill, /\*\*Double-click\*\* \(or \*\*Enter\*\* on a focused dot\) opens the card, and \*\*Ctrl\+Space\*\* on a focused dot selects it, as a click does/);
  assert.match(webSkill, /double-click, Enter, Ctrl\+Space, hover and focus lighting, the card menu/);
  assert.match(webSkill, /the card menu, double-click, Enter, Ctrl\+Space and the zoom work as in Hierarchy/);
});

test('the web skill\'s On hover show bullet names the key handler, its guard, the pure pieces and the write reason', () => {
  const text = bullet(webSkill, '- **On hover show**', '- **Speedbumps**');
  assert.match(text, /\*\*Space takes the hover\*\*: `onHoverSpaceKey` \(`hover-show-ui\.js`\), one `keydown` listener on the document that reads the whole key guard \(`keyGuardDetailOff`/);
  assert.match(text, /leaves a target that answers Space itself \(`HOVER_SPACE_OWN`/);
  assert.match(text, /a key a handler already took \(a todo item's tick\)/);
  assert.match(text, /`hotkeySpace` \(`hotkeys\.js`, pure\) reads the chord: Space is `write`, Shift\+Space `add`, Ctrl or Cmd with Space `select`, any other chord and a held key none/);
  assert.match(text, /the text is `hoverShowTerms` \(`hover-show\.js`: one `kind:id` per ticked set, in the panel's order, joined by ` \| `\) put in the box by `searchWithTerms` \(`search\.js`, which Explore's Path and Tree use too\)/);
  assert.match(text, /The write is `writeSearch\(text, 'hover'\)`\. `hover` is a write reason of its own, not one of `ISOLATING_REASONS` \(`selection\.js`\), so it never turns isolate on whatever the view's Typing isolates says/);
  assert.match(text, /With no card, or no set ticked, nothing is written and the key is not prevented/);
  assert.match(text, /In the Graph `Ctrl\+Space` \(or Cmd\) on a focused dot is the selection/);
});

test('the words that said Space selects a card are gone from the docs', () => {
  assert.doesNotMatch(webSkill, /\*\*Space\*\* selects/);
  assert.doesNotMatch(webSkill, /Enter, Space, hover and focus lighting/);
  assert.doesNotMatch(webSkill, /double-click, Enter, Space and the zoom/);
  assert.doesNotMatch(webDoc, /double-click, Enter, Space, hovering and focus/);
});

test('the page wires the write: the listener is on the document, the reason is not an isolating one, and the Graph reads the select chord', () => {
  const ui = fs.readFileSync(path.join(root, 'skills', 'web', 'web', 'hover-show-ui.js'), 'utf8');
  assert.match(ui, /document\.addEventListener\('keydown', onHoverSpaceKey\)/);
  assert.match(ui, /writeSearch\(text, 'hover'\)/);
  const graph = fs.readFileSync(path.join(root, 'skills', 'web', 'web', 'graph-view.js'), 'utf8');
  assert.match(graph, /hotkeySpace\(e\) === 'select'/);
  const { writeEditsPills } = require('../web/selection');
  assert.strictEqual(writeEditsPills('hover'), true, 'a Space write replaces what the box held, so it takes a pill off');
});
