const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOTKEYS } = require('../../plugin/skills/web/web/hotkeys');

// Repeated Esc ends on an empty search box, the `slice:` run included. The web skill, the web docs
// and the Hotkeys list say so, and none still says that Esc away from the box leaves the box alone.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const multi = flat(skill.slice(skill.indexOf('**Esc** steps the selection back'), skill.indexOf('Bulk targets are fixed when an')));
const skillIsolate = flat(skill.slice(skill.indexOf('- **Isolate**'), skill.indexOf('- **Preferences sheet**')));
const docsIsolate = flat(docs.slice(docs.indexOf('**Isolate**'), docs.indexOf('**Notifications inbox**')));
const docsBulk = flat(docs.slice(docs.indexOf('A click on empty space never touches the selection'), docs.indexOf('![Bulk context menu]')));
const escRow = HOTKEYS.find((entry) => entry.id === 'escape').what;

test('the web skill\'s multi-select entry says that once nothing is picked Esc clears the box, the slice run included', () => {
  assert.match(multi, /away from the box Esc steps the selection back and, once nothing is picked, clears the box as well, the run of `slice:` included, so repeated Esc ends on an empty box/);
  assert.match(multi, /any other text in the box stays through those stages and goes with the last Esc/);
  assert.match(multi, /`escapeStage`: isolate, selection, box/);
});

test('the Isolate entries of the skill and the docs put the box clear after the anchor', () => {
  assert.match(skillIsolate, /then the anchor, and with nothing left to step back one more Esc clears the box, the run of slices included/);
  assert.match(docsIsolate, /then the anchor, and with nothing left to step back one more Esc empties the box, a `slice:` run included/);
});

test('the docs\' empty-space entry ends the Esc order on an empty box', () => {
  assert.match(docsBulk, /once nothing is selected, one more Esc empties the box, a `slice:` run included, so repeated Esc ends on a clean page/);
});

test('the search panel entries say that stepping the selection back clears the box once nothing is picked', () => {
  assert.match(flat(skill), /steps the selection back \(and clears the box once nothing is picked\)/);
  assert.match(flat(docs), /and with nothing selected empties it/);
});

test('the Hotkeys list gives Esc the last stage', () => {
  assert.match(escRow, /isolate off, then the additions, then the anchor, and then it clears what the box still holds, a slice: run included, so repeated Esc ends on an empty box/);
});

test('no entry still says that Esc away from the box leaves the box as it was', () => {
  for (const text of [flat(skill), flat(docs)]) {
    assert.doesNotMatch(text, /away from the box Esc no longer clears it/);
    assert.doesNotMatch(text, /Esc away from the box leaves the box text/);
  }
  assert.doesNotMatch(escRow, /elsewhere it steps the selection back: isolate off, then the additions, then the anchor\.$/);
});

test('Esc with focus in the box is said to empty the box and the selection, not to leave the selection', () => {
  assert.match(flat(skill), /with focus in the search box Esc ends where repeated Esc does: it empties the box, the run of `slice:` included, and leaves nothing selected/);
  assert.match(flat(skill), /empties the box and the selection, with focus in it/);
  assert.match(flat(docs), /and then empties the box and the selection, when focus is in it/);
  assert.match(escRow, /in the search box it empties the box and the selection/);
  for (const text of [flat(skill), flat(docs), escRow]) {
    assert.doesNotMatch(text, /Esc clears the box and leaves the selection/);
    assert.doesNotMatch(text, /in the search box it clears the box,/);
  }
});
