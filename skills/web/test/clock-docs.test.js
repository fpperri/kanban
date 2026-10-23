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

test('the notes palette says an untouched date or time follows the clock and Enter writes that moment', () => {
  assert.match(notes, /A palette left open reads the clock when it writes, not when it opened/);
  assert.match(notes, /a date or time field you have not touched follows the clock/);
  assert.match(notes, /Enter writes the day and time of that moment/);
  assert.match(notes, /a day or time the request gave .* and one you typed stay as they are/);
});

test('the clock paragraph says every today moves across midnight and every stamp reads the clock at the write', () => {
  assert.match(clock, /an open page reads the clock when it needs it, never a value it took earlier/);
  assert.match(clock, /moves to the new day across midnight and when the page is shown again, without a reload/);
  assert.match(clock, /a Calendar or Gantt window you have not moved moves with it/);
  assert.match(clock, /is read at the moment of the write/);
  assert.match(clock, /A field you filled in yourself keeps what you typed/);
});

test('the Calendar section says an unmoved window follows the clock', () => {
  assert.match(calendar, /The Calendar and the Gantt open on today, and until you move their window with the arrows or a jump they follow the clock across midnight/);
});
