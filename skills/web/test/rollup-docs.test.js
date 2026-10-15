const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = read('docs', 'web.md');

const bullet = () => {
  const start = webSkill.indexOf('- **Parent cards: altitude badge and roll-up bar**');
  assert.ok(start > -1, 'the web skill has a parent-cards bullet');
  return webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
};

test('the web skill describes the badge, the leaves-only bar, and the open and collapsed choices', () => {
  const text = bullet();
  assert.match(text, /`▲n`/);
  assert.match(text, /leaves/);
  assert.match(text, /collapsed/);
  assert.match(text, /open/);
  assert.match(text, /remembered per board in `localStorage`/);
});

test('the web skill says every bar shares one mode, a click flips it, there is no header control, and the old off reads collapsed', () => {
  const text = bullet();
  assert.match(text, /Every bar on the page shares one mode, open or collapsed/);
  assert.match(text, /Clicking any bar, on a board card or in the card detail, flips it for all of them without opening the card/);
  assert.match(text, /the mode is remembered per board in `localStorage`/);
  assert.match(text, /retired `off` reads as collapsed/);
  assert.doesNotMatch(text, /and off/, 'off is not offered as a choice');
  assert.doesNotMatch(text, /\bselect\b|checkbox|header's|Bar setting|the controls/, 'no word of the header controls that are gone');
});

test('the web skill puts the roll-up in the card detail under the thread and above the fields, following the setting', () => {
  const text = bullet();
  assert.match(text, /right under the title and thread, above the fields, in the same mode/);
  assert.match(text, /thin bar when collapsed, the bar with its numbers and a scope line when open/);
});

test('the web skill says the children in the card detail start collapsed behind a header with their count', () => {
  const start = webSkill.indexOf('- **Thread and children**');
  const text = webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
  assert.match(text, /behind a \*\*Children\*\* header that carries their count/);
  assert.match(text, /starts collapsed every time a card opens; one click on the header expands it and another collapses it/);
});

test('the web skill says a right-click inside the card detail opens the card menu, and when it does not', () => {
  const start = webSkill.indexOf('- **Multi-select**');
  const text = webSkill.slice(start, webSkill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
  assert.match(text, /Right-clicking inside an open card detail opens the same menu for the card shown/);
  assert.match(text, /with text selected, or on anything that already handles the right-click itself, the browser's own menu shows instead/);
});

test('the web skill says archived leaves always count as done, with nothing to turn off', () => {
  const text = bullet();
  assert.match(text, /Archived leaves always count as done, so archiving a finished story leaves its parent's done count unchanged/);
  assert.doesNotMatch(text, /Archived\*\*|by default|left out/);
});

test('the web skill says the scope line counted this board only, and why', () => {
  const text = bullet();
  assert.match(text, /this board only/);
  assert.match(text, /cannot know about children on a board it never reads/);
});

test('the web skill says marking a parent done with open leaves warns and still saves', () => {
  const text = bullet();
  assert.match(text, /warning and saves anyway/);
  assert.match(text, /literal status `done`/);
});

test('the web skill says the derived values are never written to a card', () => {
  assert.match(bullet(), /never written to a card/);
});

test('the human docs mention the badge, the bar and the warning', () => {
  const text = webDoc.replace(/\s+/g, ' ');
  assert.match(text, /`▲n`/);
  assert.match(text, /this board only/);
  assert.match(text, /warns and saves anyway/);
});

test('the human docs say clicking a bar flips them all, the detail follows, archived leaves count, children open from a header, and the card menu works in the detail', () => {
  const text = webDoc.replace(/\s+/g, ' ');
  assert.match(text, /Every bar is either collapsed \(a thin line\) or open \(with counts\), and clicking any bar flips them all/);
  assert.match(text, /Archived leaves count as done\. The bar choice is remembered per board in your browser/);
  assert.doesNotMatch(text, /\*\*Bar\*\* select|\*\*Archived\*\* checkbox/, 'no word of the header controls that are gone');
  assert.match(text, /under its title and thread, above the fields/);
  assert.match(text, /a \*\*Children\*\* header with their count opens the list/);
  assert.match(text, /right-clicking inside an open card opens the same menu for that card/);
});
