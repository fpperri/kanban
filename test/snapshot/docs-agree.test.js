const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The snapshot skill and the snapshot doc say what the page shares with kanban-web (the
// search grammar, the slices, the pills, the icons) and what it deliberately leaves to it
// (Isolate, the selection, the Graph), and the two agree: a pill is an affordance that
// edits the box in place, so the gap the skill names for the badges is about the badges.

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');

const skill = read('plugin', 'skills', 'snapshot', 'SKILL.md');
const docs = read('docs', 'snapshot.md');

const gaps = flat(skill.slice(skill.indexOf('## What the editor deliberately does not do')));

test('the gaps section names Isolate, the selection and the Graph, each as web-only', () => {
  assert.ok(gaps.length > 500, 'the section is found');
  assert.match(gaps, /\*\*No Isolate switch and no selection\.\*\*/);
  assert.match(gaps, /\*\*No Graph view\.\*\*/);
  assert.match(gaps, /Graph[^.]*(three layouts|tier fan)/);
  assert.match(gaps, /Graph[^.]*option row[^.]*lighting[^.]*names[^.]*no counterpart/);
  assert.match(gaps, /The `l` key that steps the fan's names goes with it/);
  assert.match(gaps, /kanban-web only|only in kanban-web|kanban-web's/);
});

test('the gaps section says the Calendar and the Gantt do not jump to the nearest match, and the doc agrees', () => {
  assert.match(gaps, /\*\*No jump to the nearest match\.\*\*/);
  assert.match(gaps, /Calendar and Gantt[^.]*move to the match nearest/);
  assert.match(gaps, /`nearestMatchDay`/);
  assert.match(gaps, /stay on the month or the range they show/);
  assert.match(flat(docs), /do not jump to the nearest match/);
});

test('the skill does not say the editor has no query-append affordance, since a pill appends to the box', () => {
  assert.doesNotMatch(flat(skill), /no additive query-append affordance/);
  assert.match(flat(skill), /no badge is tap-to-filter here/);
  assert.match(flat(skill), /the panel's pills and slice entries are the controls that edit the box in place/);
});

test('the snapshot doc describes the search grammar kanban-web has: or, brackets, quotes, waiting: and slice:', () => {
  const text = flat(docs);
  assert.match(text, /same query grammar as kanban-web/);
  assert.match(text, /`\|` is or/);
  assert.match(text, /round brackets group/);
  assert.match(text, /`tags:"grill"`/);
  assert.match(text, /`waiting:`/);
  assert.match(text, /`slice:objective\.\.2`/);
  assert.match(text, /after `slice:` and after `\.\.`/i);
});

test('the snapshot doc says what the page leaves to kanban-web: Isolate, the selection and the Graph', () => {
  const text = flat(docs);
  assert.match(text, /no Isolate switch/);
  assert.match(text, /no selection/);
  assert.match(text, /no Graph view/);
});

test('the gaps section names the logbook, groups and the scratchpad, each as web-only in this release', () => {
  assert.match(gaps, /\*\*No logbook\.\*\*/);
  assert.match(gaps, /notes palette[^.]*Calendar[^.]*no counterpart/);
  assert.match(gaps, /\*\*No groups beyond the search term\.\*\*/);
  assert.match(gaps, /badges[^.]*Group tab[^.]*iteration dropdown[^.]*no counterpart/);
  assert.match(gaps, /\*\*No scratchpad\.\*\*/);
  assert.match(gaps, /scratchpad[^.]*(web-only|only in kanban-web|kanban-web only)/);
  assert.match(gaps, /web-only in this release/);
});

test('the snapshot doc says the logbook, groups and the scratchpad are kanban-web only', () => {
  const text = flat(docs);
  assert.match(text, /no logbook, no group badges, Group tab or iteration dropdown, and no scratchpad/);
});
