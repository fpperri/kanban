'use strict';
// The Calendar time grid's scale: minutes from midnight to pixels down a day's column and back, over
// 24 hours that may each have their own height. In Grouped mode every hour is HSCALE_HOUR_PX (40px, the
// stripe in app.css and app.js's CAL_HOUR_PX); in Each note mode an hour grows to hold its stacked
// note chips. Time is linear inside an hour, so a card block spanning a tall hour stretches with it.
//
// Pure: Node tests drive it with plain arrays. Same dual-environment export pattern as notes.js.

const HSCALE_HOUR_PX = 40;
const HSCALE_CHIP_PX = 20;
const HSCALE_HOURS = 24;

function plainHeights() {
  return Array.from({ length: HSCALE_HOURS }, () => HSCALE_HOUR_PX);
}

// Per-hour heights from each shown day's note counts per hour (24 numbers a day): the most notes any
// day has in an hour, one chip row each, never under the plain hour.
function eachHeights(dayCounts) {
  const heights = plainHeights();
  for (const counts of dayCounts) {
    for (let h = 0; h < HSCALE_HOURS; h++) heights[h] = Math.max(heights[h], (counts[h] || 0) * HSCALE_CHIP_PX);
  }
  return heights;
}

function hourScale(heights) {
  const tops = [0];
  for (let h = 0; h < HSCALE_HOURS; h++) tops.push(tops[h] + heights[h]);
  const total = tops[HSCALE_HOURS];
  return {
    total,
    top: (h) => tops[h],
    height: (h) => heights[h],
    yOf(min) {
      const m = Math.max(0, Math.min(HSCALE_HOURS * 60, min));
      const h = Math.min(HSCALE_HOURS - 1, Math.floor(m / 60));
      return tops[h] + ((m - h * 60) / 60) * heights[h];
    },
    minOf(y) {
      if (y <= 0) return 0;
      if (y >= total) return HSCALE_HOURS * 60;
      let h = 0;
      while (h < HSCALE_HOURS - 1 && y >= tops[h + 1]) h++;
      return h * 60 + ((y - tops[h]) / heights[h]) * 60;
    },
  };
}

// A column background drawing a 1px line at the foot of each hour, wherever the hours end.
function hourLinesCss(scale, color) {
  const stops = [];
  for (let h = 0; h < HSCALE_HOURS; h++) {
    const from = scale.top(h);
    const end = scale.top(h + 1);
    stops.push(`transparent ${from}px ${end - 1}px`, `${color} ${end - 1}px ${end}px`);
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

const HOUR_SCALE_EXPORTS = { plainHeights, eachHeights, hourScale, hourLinesCss, HSCALE_HOUR_PX, HSCALE_CHIP_PX };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HOUR_SCALE_EXPORTS;
} else {
  Object.assign(window, HOUR_SCALE_EXPORTS);
}
