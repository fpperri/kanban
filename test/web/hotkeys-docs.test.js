const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { HOTKEYS } = require('../../plugin/skills/web/web/hotkeys');

// The web skill and the web docs describe the Hotkeys section of the preferences sheet and the ?
// key: what the list holds (every key of hotkeys.js, named as the list labels it), the states
// that show, when the state is read, how ? opens the sheet at the section and when it does nothing.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillPrefs = flat(skill.slice(skill.indexOf('- **Preferences sheet**'), skill.indexOf('- **Hover/focus highlight**')));
const docsPrefs = flat(docs.slice(docs.indexOf('**Preferences**'), docs.indexOf('## Other surfaces')));
const skillHotkeys = skillPrefs.slice(skillPrefs.indexOf('**Hotkeys**'), skillPrefs.indexOf('The sheet closes on Esc'));
const docsHotkeys = docsPrefs.slice(docsPrefs.indexOf('*Hotkeys*'), docsPrefs.indexOf('The sheet closes with Esc'));
const BOTH = [['the web skill', skillHotkeys], ['the web docs', docsHotkeys]];

test('both have a Hotkeys entry in the preferences sheet', () => {
  for (const [where, text] of BOTH) assert.ok(text.length > 400, `${where}: the Hotkeys entry is found`);
});

test('both name every key the list holds, as the list labels it', () => {
  for (const [where, text] of BOTH) {
    for (const entry of HOTKEYS) {
      for (const label of entry.keys) assert.ok(text.includes(`\`${label}\``), `${where}: \`${label}\``);
    }
  }
});

test('both say the list shows the state of the keys that have one, and which', () => {
  for (const [where, text] of BOTH) {
    for (const state of ['`names: relevant`', '`slice: all`', '`pill: off`', '`isolate: off`', '`panel on focus: on`']) assert.ok(text.includes(state), `${where}: ${state}`);
    assert.match(text, /the state it is in/, where);
  }
});

test('both say when the state is read: at each opening, and at once for the panel-on-focus choice made in the sheet', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /read each time the sheet opens/, where);
    assert.match(text, /panel on focus` row follows the checkbox at once/, where);
  }
});

test('both say ? opens the sheet at the section, and when it does nothing', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`\?` opens the sheet at this section/, where);
    assert.match(text, /field/, where);
    assert.match(text, /card menu|menu/, where);
    assert.match(text, /dialog/, where);
    assert.match(text, /notifications panel/, where);
    assert.match(text, /preferences sheet|the sheet itself/, where);
  }
  assert.match(skillHotkeys, /shared key guard/);
  assert.match(skillHotkeys, /`\?` works with it open/, 'the skill says the search panel is no popup for the key');
  assert.match(skillHotkeys, /Shift with the slash key/);
});

test('both say the list is to read: the keys are not changed there', () => {
  for (const [where, text] of BOTH) assert.match(text, /to read, not to change/, where);
});

test('the skill\'s key guard entry names ?', () => {
  const guard = flat(skill.slice(skill.indexOf('Both read one **key guard**'), skill.indexOf('- **Comboboxes**')));
  assert.match(guard, /`\?`, which opens the Hotkeys list/);
});

test('the list is described as one list the page\'s own handlers are held to', () => {
  assert.match(skillHotkeys, /`hotkeys\.js`/);
  assert.match(skillHotkeys, /fails when a handler reads a key the list lacks/);
});
