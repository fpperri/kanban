'use strict';
// The one reader and writer of a note's duration (docs/adr/0016, the logbook), the length of work a
// note may carry, that the logbook store, the notes palette and the tray share, so they agree on what a
// length is: `45m`, `1h`, `1h30m` or `1h30` (minutes after hours under 60), in any case. Same
// dual-environment pattern as ids.js: loaded as a plain <script> in the browser (one global,
// window.kanbanDurations) AND required directly by node --test.

const durationsModule = (() => {
  const LENGTH = String.raw`(?:(\d+)h(?:(\d{1,2})m?)?|(\d+)m)`;
  const LENGTH_RE = new RegExp(`^${LENGTH}$`, 'i');
  const LEADING_RE = new RegExp(String.raw`^(${LENGTH})(?=\s|$)\s*`, 'i');

  // A length's whole minutes, null for anything that is not one.
  function parseDuration(text) {
    const m = typeof text === 'string' ? LENGTH_RE.exec(text.trim()) : null;
    if (!m) return null;
    if (m[3] !== undefined) return Number(m[3]);
    const minutes = m[2] === undefined ? 0 : Number(m[2]);
    return minutes < 60 ? Number(m[1]) * 60 + minutes : null;
  }

  // The length a line starts with, a space or nothing after it: { text, minutes, rest }, `text` as it is
  // written, `minutes` null for one shaped like a length that is none (`1h60`), `rest` the line after it
  // and its spaces. A line that starts with no length is null.
  function leadingDuration(line) {
    const m = LEADING_RE.exec(line);
    return m ? { text: m[1], minutes: parseDuration(m[1]), rest: line.slice(m[0].length) } : null;
  }

  // The one written form of a length: `45m`, `1h`, `1h30m`, `2h5m`.
  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h ? `${h}h` : ''}${m || !h ? `${m}m` : ''}`;
  }

  const DAY_MIN = 24 * 60;
  const pad = (n) => String(n).padStart(2, '0');
  // A time's minutes from midnight (HH:MM, padded), and minutes as HH:MM (24:00 for the end of the day).
  const minutesOf = (at) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  // What a duration breaks, '' for nothing: it is whole minutes, at least 1; with a time (`at`,
  // HH:MM) the start plus the duration ends by 24:00; without one it is at most 24h.
  function durationProblem(minutes, at) {
    if (!(minutes >= 1)) return 'A duration is at least 1 minute.';
    if (at) return minutesOf(at) + minutes <= DAY_MIN ? '' : `A note with a time ends by 24:00; ${at} plus ${formatDuration(minutes)} does not.`;
    return minutes <= DAY_MIN ? '' : 'A duration with no time is at most 24h.';
  }

  // A note's range as it reads: its start, an en dash and its end, the start plus the duration, never
  // wrapped round to the morning. Midnight at the end is 24:00.
  function durationRange(at, minutes) {
    return `${at}–${hhmm(minutesOf(at) + minutes)}`;
  }

  return { parseDuration, leadingDuration, formatDuration, durationProblem, durationRange, minutesOf, hhmm };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = durationsModule;
} else {
  window.kanbanDurations = durationsModule;
}
