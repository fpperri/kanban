// What the search panel's tests share: reading the panel's controls off the built
// page, and the gestures a person makes on them. Not a test file (the suite runs
// *.test.js only).
const { byClass } = require('./page-harness');

// The box is a text input in the real page; the harness makes elements of any kind, so
// say which this one is before focus moves into it (the keys read what has focus).
function asInput(el) {
  el.tagName = 'INPUT';
  return el;
}

const boxEl = (page) => asInput(page.byId('q'));
const boxText = (page) => page.byId('q').value;

// A person puts the cursor in the box: with the panel's switch on, the panel opens.
function openPanel(page) {
  boxEl(page).focus();
  return page;
}

// Moves focus off any field, as a tap on the board's empty space would.
function blurBox(page) {
  const board = page.byId('board');
  board.tagName = 'DIV';
  board.focus();
}

const text = (el) => el.textContent;

// The pills the pill section draws now, in order: key, label, count (a number), whether on,
// and the button.
function pills(page) {
  return byClass(page.byId('search-pills'), 'query-pill').map((el) => ({
    key: el.dataset.pillKey,
    label: text(byClass(el, 'query-pill-label')[0]),
    count: Number(text(byClass(el, 'query-pill-count')[0])),
    on: el.getAttribute('aria-pressed') === 'true',
    el,
  }));
}

const pill = (page, label) => {
  const found = pills(page).find((p) => p.label === label);
  if (!found) throw new Error(`no pill labelled ${label}: ${pills(page).map((p) => p.label)}`);
  return found;
};

// The "+N more" button of the pill section, or undefined.
const moreButton = (page) => byClass(page.byId('search-pills'), 'query-pill-more')[0];

// The slice entries the slice section draws now: key, label, count, whether in the run, icon glyph.
function sliceEntries(page) {
  return byClass(page.byId('search-slices'), 'slice-entry').map((el) => ({
    key: el.dataset.sliceKey,
    label: text(byClass(el, 'slice-entry-label')[0]),
    count: Number(text(byClass(el, 'slice-entry-count')[0])),
    inRun: el.getAttribute('aria-pressed') === 'true',
    icon: text(byClass(el, 'slice-entry-icon')[0]),
    name: el.getAttribute('aria-label'),
    el,
  }));
}

const entry = (page, label) => {
  const found = sliceEntries(page).find((s) => s.label === label);
  if (!found) throw new Error(`no slice entry labelled ${label}: ${sliceEntries(page).map((s) => s.label)}`);
  return found;
};

module.exports = { asInput, blurBox, boxEl, boxText, entry, moreButton, openPanel, pill, pills, sliceEntries, text };
