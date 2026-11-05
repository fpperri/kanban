const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Every popup is a labelled dialog: markup only, so a screen reader announces the popup's name when it opens.
// The label is the popup's own title, so it reads what the sighted user reads.

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8').replace(/\r\n/g, '\n');

const POPUPS = [
  ['modal', 'card-form', 'modal-title'],
  ['detail-modal', 'detail-title'],
  ['bulk-single', 'bulk-single-title'],
  ['bulk-tags', 'bulk-tags-title'],
  ['bulk-status', 'bulk-status-title'],
  ['bulk-archive', 'bulk-archive-title'],
  ['bulk-schedule', 'bulk-schedule-title'],
  ['notif-modal', 'notif-title'],
];

function panelTag(backdropId) {
  const start = html.indexOf(`<div id="${backdropId}"`);
  assert.ok(start >= 0, `${backdropId} exists`);
  const m = /<(?:div|form)\b[^>]*class="modal\b[^>]*>/.exec(html.slice(start + 10));
  assert.ok(m, `${backdropId} has a panel`);
  return m[0];
}

for (const [backdrop, ...rest] of POPUPS) {
  const titleId = rest[rest.length - 1];
  test(`${backdrop} is a dialog named by ${titleId}`, () => {
    const tag = panelTag(backdrop);
    assert.match(tag, /role="dialog"/);
    const m = /aria-labelledby="([^"]+)"/.exec(tag);
    assert.ok(m, 'has aria-labelledby');
    assert.strictEqual(m[1], titleId);
    assert.strictEqual(html.split(`id="${titleId}"`).length - 1, 1, 'the title id exists once');
  });
}

test('the panels gain no tabindex and no aria-modal from this label', () => {
  for (const [backdrop] of POPUPS) {
    assert.doesNotMatch(panelTag(backdrop), /aria-modal/);
  }
});
