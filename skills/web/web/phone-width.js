'use strict';
// The one width line of the Web: under 760 px the layout is the phone's. The stylesheet writes the
// same line in its media queries (max-width: 759.98px, min-width: 760px), and a source test holds
// every width query in app.css to it. A script that has to follow the line passes
// PHONE_WIDTH_QUERY to matchMedia, so it flips at the same width as the stylesheet. The line is the
// option panel's (view-panel.js): the panel opens beside the view from 760 px and over it below.
//
// Pure. Same dual-environment export pattern as view-panel.js.

const PHONE_WIDTH_VIEW_PANEL = (typeof module !== 'undefined' && module.exports)
  ? require('./view-panel')
  : window;

const PHONE_WIDTH_LINE_PX = PHONE_WIDTH_VIEW_PANEL.VIEW_PANEL_WIDE_PX;
// 0.02 px under the line, the way the stylesheet writes it, so no width is both phone and not.
const PHONE_WIDTH_QUERY = `(max-width: ${Number((PHONE_WIDTH_LINE_PX - 0.02).toFixed(2))}px)`;

function isPhoneWidth(width) {
  return typeof width === 'number' && width < PHONE_WIDTH_LINE_PX;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PHONE_WIDTH_LINE_PX, PHONE_WIDTH_QUERY, isPhoneWidth };
} else {
  window.PHONE_WIDTH_LINE_PX = PHONE_WIDTH_LINE_PX;
  window.PHONE_WIDTH_QUERY = PHONE_WIDTH_QUERY;
  window.isPhoneWidth = isPhoneWidth;
}
