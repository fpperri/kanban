const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- pill interaction grammar (left toggle, right solo) documented ONCE, where
// the shared status-filter pill row is first described (the map section) —
// guards against the doc drifting out of sync with the shared soloStatusFilter
// behavior (column-state.js).

const webSkill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the right-click SOLO grammar alongside the pill row description', () => {
  assert.match(webSkill, /right-click SOLOs it/);
  assert.match(webSkill, /restores ALL pills on/);
});

test('SKILL.md ties the solo grammar to the left-click single-pill toggle', () => {
  assert.match(webSkill, /left-click toggles that one pill on\/off/);
});

test('SKILL.md documents contextmenu suppression as scoped to a pill only, not the shared card bulk menu', () => {
  assert.match(webSkill, /suppressed only on a pill itself/);
  assert.doesNotMatch(webSkill, /suppressed only while the pointer is over the pill row/);
  assert.match(webSkill, /the gantt's, the calendar's and the graph's/, 'all four pill rows are named');
  assert.match(webSkill, /shared right-click bulk\s*\n?\s*menu untouched/);
});

// The calendar's status-filter row needs its own dedicated write-up, in the
// Calendar section specifically — the map and gantt each carry one, and the
// calendar's went silently missing once before. Pinning its contract here so
// it can't quietly disappear again.
test('SKILL.md gives the calendar its own dedicated status-filter write-up, in the Calendar view section', () => {
  const calendarSection = webSkill.match(/- \*\*Calendar view\*\*[\s\S]*?\n- \*\*Gantt view\*\*/);
  assert.ok(calendarSection, 'the Calendar view bullet is present');
  assert.match(calendarSection[0], /\*\*Status-filter row\*\*/, 'the calendar gets its own dedicated status-filter paragraph, like the map\'s and gantt\'s');
  // The calendar renders archived cards opt-in, via an Archive pill that
  // defaults OFF — both facts belong in prose, not just in the code.
  assert.match(calendarSection[0], /Archive pseudo-pill/, 'the Archive pill is documented in prose');
  assert.match(calendarSection[0], /defaults \*\*OFF\*\*/, 'the archive-off-by-default rule is stated in prose');
  assert.match(calendarSection[0], /calendar\.statusFilter/, 'the persistence key is named');
  assert.match(calendarSection[0], /\*\*intersection\*\*/, 'search+status composition is documented');
});
