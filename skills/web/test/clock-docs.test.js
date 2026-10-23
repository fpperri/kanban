const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// docs/web.md says that an open page reads the clock when it writes and when it shows today. These tests
// pin the sentences, so a change to the page that leaves the docs behind fails here.

const docs = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const part = (from, to) => flat(docs.slice(docs.indexOf(from), docs.indexOf(to, docs.indexOf(from) + from.length)));

const notes = part('**Notes** —', '**Text boxes** —');
const clock = part('**The clock** —', '**Search** —');
const calendar = part('## Calendar', '## More on the board');
const skill = flat(fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8'));

test('the notes palette says Today and Now are worked out when Enter is pressed', () => {
  assert.match(notes, /A palette left open reads the clock when it writes, not when it opened/);
  assert.match(notes, /the date and time fields start on \*\*Today\*\* and \*\*Now\*\*, and Enter works them out when it is pressed/);
  assert.match(notes, /a note written after midnight, or an hour later, gets that moment's day and time/);
  assert.match(notes, /The \*\*Today\*\* and \*\*Now\*\* buttons beside the fields \(or typing the word\) put a field back on it/);
  assert.match(notes, /A date or time you picked or typed is used as it is, even when it equals today or now, and stays for the next note/);
  assert.match(notes, /a day or time the request gave .* opens as that picked value/);
  assert.match(notes, /drawn again each minute and when the page is shown again/);
});

test('the clock paragraph says every today moves across midnight and every stamp reads the clock at the write', () => {
  assert.match(clock, /an open page reads the clock when it needs it, never a value it took earlier/);
  assert.match(clock, /moves to the new day across midnight and when the page is shown again, without a reload/);
  assert.match(clock, /a Calendar or Gantt window you have not moved moves with it/);
  assert.match(clock, /is read at the moment of the write/);
  assert.match(clock, /A field you filled in yourself keeps what you typed, and a notes date or time left on Today or Now is worked out when Enter is pressed/);
});

test('the Calendar section says an unmoved window follows the clock', () => {
  assert.match(calendar, /The Calendar and the Gantt open on today, and until you move their window with the arrows or a jump they follow the clock across midnight/);
});

test('SKILL.md says Today and Now are worked out at Enter, from the page one clock', () => {
  assert.match(skill, /a \*\*Today\*\* button, a time field with a menu \(`notesTimeOptions`: Now, then every half hour\) and a \*\*Now\*\* button/);
  assert.match(skill, /Today and Now are worked out from the clock when Enter is pressed \(`noteWritePlan` reads `o\.today` and `o\.now`; the page's one clock is `kanbanDays\.now`, days\.js\)/);
  assert.match(skill, /a field on Today or Now stays on it after a write, and a date or time picked or typed is used as it is, even when it equals today or now, and stays/);
  assert.match(skill, /The page's clock tick \(`clockTick`, app\.js, every 15 seconds and when the page becomes visible\) draws the preview again \(`notesFollowClock`\)/);
});
