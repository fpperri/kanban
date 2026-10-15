const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill and the web docs describe the gear, the sheet and each setting.

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = read('docs', 'web.md');

const skillBullet = () => {
  const start = webSkill.indexOf('- **Preferences sheet**');
  assert.ok(start > -1, 'the web skill has a preferences sheet bullet');
  return flat(webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)));
};

const docSection = () => {
  const start = webDoc.indexOf('**Preferences**');
  assert.ok(start > -1, 'the web docs have a preferences paragraph');
  return flat(webDoc.slice(start, webDoc.indexOf('\n## ', start)));
};

test('the web skill describes the gear and the sheet that slides in from the right', () => {
  const text = skillBullet();
  assert.match(text, /the gear at the right end of the header opens a full-height sheet from the right/);
});

test('the web skill says the settings are kept in the browser per board, never written to the board, and apply at once', () => {
  const text = skillBullet();
  assert.match(text, /kept in the browser per board/);
  assert.match(text, /`localStorage`/);
  assert.match(text, /never written to the board/);
  assert.match(text, /applies the moment it is chosen/);
});

test('the web skill describes the click setting: per view, opens by default, the Graph fixed, a double click or Enter opens', () => {
  const text = skillBullet();
  assert.match(text, /\*\*A plain click on a card\*\* opens it or selects it, chosen separately for the Board, the Map, the Gantt and the Calendar/);
  assert.match(text, /the default is opens, as before/);
  assert.match(text, /the Graph is shown fixed at selects/);
  assert.match(text, /a double click, or Enter on a focused card, opens it/);
  assert.match(text, /A double click on a Calendar card opens it and never starts a new card/);
  assert.match(text, /Opening a card that way is a peek: the selection stays as it was/);
});

test('the web skill describes the roll-up settings and the old key that is no longer read', () => {
  const text = skillBullet();
  assert.match(text, /\*\*Roll-up bar\*\* is open or collapsed, the one choice a click on any bar flips/);
  assert.match(text, /\*\*Count archived leaves as done\*\* is on by default and feeds every roll-up: the board tile, the Map's rich row and the card detail/);
  assert.match(text, /"Archived leaves count as done\." or "Archived leaves are left out\."/);
  assert.match(text, /retired `rollup\.archived` key is not read/);
});

test('the web skill describes how the sheet closes, that it traps no Tab, and what stands still while it is open', () => {
  const text = skillBullet();
  assert.match(text, /closes on Esc, on a click outside it or with its close button, and focus goes back to the gear/);
  assert.match(text, /traps no Tab/);
  assert.match(text, /the 5s refresh does not rebuild the board under it, `\/` and Ctrl\+F do nothing/);
  assert.match(text, /a click inside it never clears a selection/);
});

test('the web skill\'s multi-select bullet says what a plain click does where the sheet sets it to select', () => {
  const start = webSkill.indexOf('- **Multi-select**');
  const text = flat(webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)));
  assert.match(text, /in a view the preferences sheet sets to selects, a plain click selects the card alone instead, and a double click, or Enter on a focused card, opens it/);
});

test('the web skill names the gear among the header\'s controls', () => {
  assert.match(flat(webSkill), /view-switch\/refresh\/notif buttons and the preferences gear/);
});

test('the human docs describe the gear, each setting, where they are kept and how the sheet closes', () => {
  const text = docSection();
  assert.match(text, /the gear at the right end of the header opens a sheet from the right/);
  assert.match(text, /kept in your browser, per board, and are never written to the board's files/);
  assert.match(text, /\*A plain click on a card\* opens the card or selects it, chosen separately for the Board, Map, Gantt and Calendar \(it opens, by default\)/);
  assert.match(text, /The Graph is shown fixed at selects/);
  assert.match(text, /a double click on a card, or Enter on a focused card, opens it and leaves the selection as it was/);
  assert.match(text, /\*Roll-up bar\* is open or collapsed, the same choice a click on any bar flips/);
  assert.match(text, /\*Count archived leaves as done\* is on by default/);
  assert.match(text, /closes with Esc, a click outside it or its close button, and focus goes back to the gear/);
});

test('neither doc describes a Bar select or an Archived checkbox in the header', () => {
  for (const text of [flat(webSkill), flat(webDoc)]) {
    assert.doesNotMatch(text, /Bar select|Archived checkbox|\*\*Bar\*\* select|\*\*Archived\*\* checkbox/);
  }
});
