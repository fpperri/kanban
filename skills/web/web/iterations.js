'use strict';
// The rules of the iteration dropdown (docs/adr/0015, GLOSSARY.md "Iteration"), apart from the
// DOM: which groups are iterations, which one the dropdown opens on, the cards a picked one cuts
// the views to, what "New iteration..." prefills, and what the Calendar shades. app.js draws the
// dropdown and applies the cut; the group form (groups-ui.js) takes the draft.
//
// An iteration is an ordinary group in the `iteration/` folder itself (no subtype). The dropdown
// shows only with `iterations: true` in config.yaml and groups on, and the choice is kept in this
// browser only (one small JSON entry), never in the board.
//
// Pure: same dual-environment export pattern as groups.js — loaded as a plain <script> in the
// browser AND required by node --test.

const ITER_GROUPS = (typeof module !== 'undefined' && module.exports) ? require('./groups') : window;
const ITER_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const ITERATION_FOLDER = 'iteration';
const ITERATION_DAY_MS = 24 * 60 * 60 * 1000;

// The board's iterations, newest start first; the undated ones last, ties by id, highest first.
function iterationList(groups) {
  return (groups || [])
    .filter((g) => g.folder === ITERATION_FOLDER)
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || '') || ITER_IDS.compareIds(b.id, a.id));
}

// The newest iteration running on the day (both end days included), or null.
function iterationRunning(groups, day) {
  return iterationList(groups).find((g) => ITER_GROUPS.groupRunning(g, day)) || null;
}

// `#I2 zephyr-2 · 2026-10-12 to 2026-10-23 · running`: what the dropdown's option reads.
function iterationLabel(group, today) {
  const dates = group.start_date && group.end_date ? `${group.start_date} to ${group.end_date}`
    : group.start_date ? `from ${group.start_date}` : group.end_date ? `until ${group.end_date}` : '';
  const parts = [ITER_GROUPS.groupLabel(group)];
  if (dates) parts.push(dates);
  if (ITER_GROUPS.groupRunning(group, today)) parts.push('running');
  return parts.join(' · ');
}

// The id the dropdown shows ('' = All cards). `saved` is what this browser kept ({ pick, under } or
// null): a kept choice wins, All cards included, while its iteration still exists and the iteration
// that was running when it was made (`under`, '' when none ran) has not ended; once that one has
// ended, or with no choice, or a gone one, the dropdown opens on the running iteration, or on All
// cards when none runs.
function iterationPick(saved, groups, today) {
  const list = iterationList(groups);
  const under = saved && typeof saved.under === 'string' ? saved.under : '';
  const ended = under !== '' && !list.some((g) => g.id === under && ITER_GROUPS.groupRunning(g, today));
  if (saved && typeof saved.pick === 'string' && !ended) {
    if (saved.pick === '') return '';
    if (list.some((g) => g.id === saved.pick)) return saved.pick;
  }
  const running = iterationRunning(groups, today);
  return running ? running.id : '';
}

// The kept choice as one JSON entry; anything else it holds reads as no choice. An entry kept before
// `under` existed, or with a bad one, reads as kept under none.
function iterationChoiceRead(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.pick !== 'string') return null;
  if (parsed.pick !== '' && ITER_IDS.idKey(parsed.pick) !== parsed.pick) return null;
  const under = typeof parsed.under === 'string' && parsed.under !== '' && ITER_IDS.idKey(parsed.under) === parsed.under ? parsed.under : '';
  return { pick: parsed.pick, under };
}

function iterationChoiceWrite(pick, under) {
  return JSON.stringify({ pick, under: under || '' });
}

// The ids of the picked iteration's cards, or null for All cards, no pick or a pick that is gone.
// The views intersect this with what the search box leaves; it never writes the box or a group.
function iterationCut(groups, pick) {
  if (!pick) return null;
  const group = iterationList(groups).find((g) => g.id === pick);
  return group ? new Set(group.cards) : null;
}

function iterationDayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / ITERATION_DAY_MS : null;
}

function iterationDayText(number) {
  return new Date(number * ITERATION_DAY_MS).toISOString().slice(0, 10);
}

// The name with its trailing number one higher (`zephyr-2` -> `zephyr-3`, `zephyr-09` -> `zephyr-10`);
// a name with no trailing number is left for the person to write.
function iterationBumpName(name) {
  const m = /^(.*?)(\d+)$/.exec(name || '');
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : '';
}

// What "New iteration..." fills in: the name of the newest iteration bumped, the dates continuing the
// day after its end at the same length, auto_join on. With no dated iteration before it, it starts today
// with no end.
function iterationNextDraft(groups, today) {
  const draft = { folder: ITERATION_FOLDER, name: '', start_date: today, end_date: '', auto_join: true };
  const last = iterationList(groups)[0];
  if (!last) return draft;
  draft.name = iterationBumpName(last.name);
  const from = iterationDayNumber(last.start_date);
  const to = iterationDayNumber(last.end_date);
  if (from !== null && to !== null && to >= from) {
    draft.start_date = iterationDayText(to + 1);
    draft.end_date = iterationDayText(to + 1 + (to - from));
  }
  return draft;
}

// The days the Calendar shades for an iteration: { start, end }, or null when it has not both dates.
function iterationSpan(group) {
  return group && group.start_date && group.end_date ? { start: group.start_date, end: group.end_date } : null;
}

function iterationShades(span, day) {
  return !!span && span.start <= day && day <= span.end;
}

const ITERATION_EXPORTS = {
  iterationList, iterationRunning, iterationLabel, iterationPick, iterationChoiceRead, iterationChoiceWrite,
  iterationCut, iterationBumpName, iterationNextDraft, iterationSpan, iterationShades,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ITERATION_EXPORTS;
} else {
  Object.assign(window, ITERATION_EXPORTS);
}
