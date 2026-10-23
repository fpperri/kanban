'use strict';
// The one reader of a day (YYYY-MM-DD) that the group and logbook stores and the iteration rules
// share, so they agree on what a day is: a real calendar date, written with four, two and two
// digits, and nothing else (no time tail, no space around it). `number` counts whole days from
// 1970-01-01, so two days subtract. Same dual-environment pattern as ids.js: loaded as a plain
// <script> in the browser (one global, window.kanbanDays) AND required directly by node --test.

const daysModule = (() => {
  const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // { year, month, day, number } for a real day, null for anything else.
  function parseDay(text) {
    const m = typeof text === 'string' ? DAY_RE.exec(text) : null;
    if (!m) return null;
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const at = new Date(Date.UTC(year, month - 1, day));
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
    return { year, month, day, number: at.getTime() / DAY_MS };
  }

  const validDay = (text) => parseDay(text) !== null;

  // The local date of a moment (now by default), as a day: the user's wall clock, which the server
  // takes for the creator's date and the page for "today".
  function localToday(at = now()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  }

  // The one clock: everything that stamps a day or a time, or shows today, reads it at the moment it
  // needs it. A test sets another with setClock(fn) (fn returns a Date) and puts the real one back
  // with setClock().
  let clock = () => new Date();
  const now = () => clock();
  function setClock(fn) {
    clock = typeof fn === 'function' ? fn : () => new Date();
  }

  return { parseDay, validDay, localToday, now, setClock };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = daysModule;
} else {
  window.kanbanDays = daysModule;
}
