const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// docs/web.md says what the notes palette, the Calendar's notes strip, the card menu and the multiline
// text boxes do. These tests pin the sentences a reader relies on, so a change to the page that leaves the
// docs behind (or a rewrite of the docs that drops a behaviour) fails here.

const docs = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const part = (from, to) => flat(docs.slice(docs.indexOf(from), docs.indexOf(to, docs.indexOf(from) + from.length)));

const notes = part('**Notes** —', '**Text boxes** —');
const textBoxes = part('**Text boxes** —', '**Scratchpad** —');
const calendar = part('## Calendar', '## Graph');
const bulk = part('**Bulk actions**', 'A click on empty space never touches the selection');

test('the Notes paragraph says where n opens the palette, and that the pointer\'s day sets the range only', () => {
  assert.match(notes, /`n` opens a palette on the card whose details are open, else the hovered or selected card/);
  assert.match(notes, /on the Calendar opens it on the Calendar's own mode and range \(Month, Week, 3 days or Day\), or on the day under the pointer/);
  assert.match(notes, /that only chooses what is listed: the note still goes to today/);
  assert.match(notes, /anywhere else it opens on today/);
});

test('it says Esc clears the card chip before it closes the palette', () => {
  assert.match(notes, /\*\*Esc\*\* clears the chip, as the backspace does, and the palette stays open on the range it opens on with no card/);
  assert.match(notes, /with no chip showing Esc closes it, and from its filter field Esc closes it at once/);
  assert.match(notes, /three presses: the chip, the palette, then the details/);
});

test('it describes the subject row: the date, the time, the untimed tick and the card picker', () => {
  assert.match(notes, /a \*\*date\*\* \(with a picker; today, or the day of the hour or all-day box the palette was opened from\) beside the \*\*time\*\*/);
  assert.match(notes, /the \*untimed\* tick, which drops the time and keeps the day/);
  assert.match(notes, /a \*\*card\*\* picker, a searchable list of \*no card\* and the live cards/);
  assert.match(notes, /a card id typed in it \(`22` or `#22`\) aims it too, on Enter or on leaving the field/);
  assert.match(notes, /a leading `#22` aims it at another card and wins over the picker/);
});

test('it describes Timeline: one flat list, days newest first, timed notes then untimed, each row naming its card', () => {
  assert.match(notes, /\*\*Grouped \| Timeline\*\* switch/);
  assert.match(notes, /remembered per board/);
  assert.match(notes, /Timeline is one flat list, days newest first and inside a day the timed notes in time order, then the untimed ones, each row naming its card/);
});

test('it describes the range: its buttons, its label, what it opens on, and that it never moves a note', () => {
  assert.match(notes, /\*\*range\*\* row over the list, All, Month, Week, 3 days or Day, with ‹ and › buttons \(off on All\)/);
  assert.match(notes, /a click on it goes back to the range that holds today/);
  assert.match(notes, /weeks start on Monday, as the Calendar's do/);
  assert.match(notes, /opens on All for a card, a group or several cards \(so a card's whole history is listed\)/);
  assert.match(notes, /on Day for the day of an hour or the all-day box it was opened from/);
  assert.match(notes, /Day, today for `n` anywhere else/);
  assert.match(notes, /is set each time the palette opens and is no memory/);
  assert.match(notes, /the date field decides the day a note is written to, and a note written outside the range stays listed/);
});

test('it says the boxes grow, Esc and the tab keys', () => {
  assert.match(notes, /grows with its text, typed and wrapped lines both, up to 12 lines or 40% of the window/);
  assert.match(notes, /`Alt\+1` to `Alt\+4` switch the open palette's first to fourth tab \(Notes, Group, Scratchpad,\s+Todos/);
});

test('the Calendar section describes the notes strip and its divider', () => {
  assert.match(calendar, /\*\*Notes\*\* button in the toolbar hides and shows them/);
  assert.match(calendar, /A \*\*divider\*\* on the strip's left edge changes the strip's width for every day at once/);
  assert.match(calendar, /drag it \(from 44px nearly to the whole column, leaving the cards a sliver\), or focus it and press Left and Right/);
  assert.match(calendar, /a double click puts the default width back/);
  assert.match(calendar, /The width is kept per board in this browser/);
});

test('the card menu is described as nested: its entries, its groups, its panels and its keys', () => {
  assert.match(bulk, /Peek, Add note… \(with its key, `n`, muted at the right\), Add child…, then \*\*Edit\*\*/);
  assert.match(bulk, /\*\*Group\*\* \(Add to group…, Make a group from them…\) and \*\*Explore\*\* \(Isolate, Dependency tree, Dependency path\)/);
  assert.match(bulk, /Archive, Restore and Delete, which is never in a group/);
  assert.match(bulk, /hover it for a moment or click it/);
  assert.match(bulk, /a panel with no room on the right opens on the left/);
  assert.match(bulk, /The menu takes the focus when it opens and gives it back when it closes, and its keys work only while focus is in it/);
  assert.match(bulk, /Up and Down move the highlight \(Home and End go to the first and last entry\)/);
  assert.match(bulk, /Esc closes the panel first and the menu second/);
  assert.match(bulk, /On a phone the panel opens under its row, inside the menu/);
});

test('Add child… is described: one live card, the form under that card, only the child written', () => {
  const add = part('**Add child…**', '\n\nA click on empty space');
  assert.match(add, /one live card only, in every view and in the card details' own menu/);
  assert.match(add, /opens the New card form as \*\*New card\*\* does, headed "New card under #42", with Parent set to that card/);
  assert.match(add, /Only the new card is written, never the parent; clear the Parent field and it saves as an ordinary root card/);
});

test('the text boxes paragraph names the four boxes and every key', () => {
  assert.match(textBoxes, /four multiline boxes take editing keys: the notes palette's note box, the box a listed note is edited in, the Scratchpad's box and the card form's description/);
  assert.match(textBoxes, /\*\*Tab\*\* indents by two spaces \(every selected line, when several are selected\) and \*\*Shift\+Tab\*\* outdents by up to two/);
  assert.match(textBoxes, /\*\*Ctrl\+M\*\* switches Tab to moving focus for keyboard-only use, until the page is reloaded/);
  assert.match(textBoxes, /"Tab indents · Ctrl\+M: Tab moves focus"\), so Tab is never a trap/);
  for (const key of ['Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Alt+S', 'Ctrl+E', 'Ctrl+K', 'Ctrl+Shift+7', 'Ctrl+Shift+8', 'Ctrl+Shift+.', 'Ctrl+Shift+D']) {
    assert.ok(textBoxes.includes(`**${key}**`), key);
  }
  assert.match(textBoxes, /the browser's Undo takes any of them back in one step/);
  assert.match(textBoxes, /Their browser actions \(view source, the address bar\) are stopped only while one of these boxes has focus/);
  assert.match(textBoxes, /Enter, Shift\+Enter, Ctrl\+Enter and Ctrl\+S keep what they do in each box, and the single-line fields \(the filter, the time, a combobox\) keep the browser's Tab/);
});
