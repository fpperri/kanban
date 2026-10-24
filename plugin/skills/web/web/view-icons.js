'use strict';
// The line icons the Web's header buttons wear, in the style of the bell and the
// gear: a 24 px box, a 2 px stroke in the current colour, no fill, so a button reads
// in light and dark by the colour it already has. One closed table of shapes; the
// views table in app.js names which shape a view's button wears. No dependencies, so
// the page loads it right after type-icons.js.
//
// A name is looked up in the table and never becomes markup; a name the table does
// not hold answers an empty string and the button draws no icon.

const VIEW_ICON_SHAPES = new Map([
  ['board', '<rect x="3" y="4" width="5" height="16" rx="1"></rect><rect x="10" y="4" width="5" height="11" rx="1"></rect><rect x="17" y="4" width="4" height="7" rx="1"></rect>'],
  ['calendar', '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>'],
  ['gantt', '<path d="M4 6h10M8 12h12M6 18h10"></path>'],
  ['map', '<circle cx="6" cy="6" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><circle cx="12" cy="18" r="2.5"></circle><path d="M8.5 6h7M7.2 8.3l3.6 7.2M16.8 8.3l-3.6 7.2"></path>'],
  ['graph', '<circle cx="12" cy="12" r="2.5"></circle><circle cx="5" cy="5" r="1.5"></circle><circle cx="19" cy="6" r="1.5"></circle><circle cx="5" cy="19" r="1.5"></circle><circle cx="19" cy="19" r="1.5"></circle><path d="M6.1 6.1l4 4M17.8 7.2l-4 3.4M6.1 17.9l4-4M17.8 17.8l-4-3.6"></path>'],
  ['refresh', '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"></path>'],
  ['new', '<path d="M12 5v14M5 12h14"></path>'],
]);

const VIEW_ICON_NAMES = Object.freeze([...VIEW_ICON_SHAPES.keys()]);

function viewIconSvg(name) {
  const inner = typeof name === 'string' ? VIEW_ICON_SHAPES.get(name) : undefined;
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VIEW_ICON_NAMES, viewIconSvg };
} else {
  window.VIEW_ICON_NAMES = VIEW_ICON_NAMES;
  window.viewIconSvg = viewIconSvg;
}
