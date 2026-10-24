const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');

// A card opens full screen on a phone (under 760 px) with a back row: a '‹ Board' back button at the
// top left, the card's edit, archive and delete buttons at the right of the same row. The layout is
// CSS-first: the back button is markup in the card detail header and the phone block of app.css
// shows it, lays the row out and hides what the phone does not use.

const webDir = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(webDir, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');

const phoneBlock = () => css.match(/\/\* The card detail on a phone[\s\S]*?\*\/\s*@media \(max-width: 759\.98px\) \{[\s\S]*?\n\}/);
const detail = html.match(/<div id="detail-modal"[\s\S]*?<div id="detail-thread"/)[0];

test('the back button is markup in the card detail header, with no style attribute, first on the action row', () => {
  const header = detail.match(/<div class="detail-header popup-header">[\s\S]*$/)[0];
  assert.match(header, /<button type="button" id="detail-back-btn" class="detail-back-btn"[^>]*>/);
  assert.match(header, /id="detail-back-btn"[^>]*aria-label="Back to the Board"/);
  assert.match(header, /&#8249;\s*Board/);
  assert.doesNotMatch(header, /style=/);
  const actions = header.match(/<div class="detail-actions">([\s\S]*?)<\/div>\s*<\/div>\s*<div id="detail-thread"$/)[1];
  const ids = [...actions.matchAll(/<button[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['detail-back-btn', 'detail-edit-btn', 'detail-archive-btn', 'detail-delete-btn', 'detail-fullscreen-btn', 'detail-close']);
});

test('the card detail has no status selector', () => {
  assert.doesNotMatch(detail, /<select/);
  assert.doesNotMatch(detail, /status-select|detail-status/);
});

test('the back button is hidden from 760 px, and shown by the phone block', () => {
  assert.match(css, /\.detail-back-btn\s*\{[^}]*display:\s*none/);
  const phone = phoneBlock();
  assert.ok(phone, 'one 759.98px block next to the detail rules');
  assert.match(phone[0], /\.detail-back-btn\s*\{[^}]*display:\s*(?:inline-)?flex/);
});

test('the phone block fills the viewport, puts the back row on one line and hides full-screen, close and copy-path', () => {
  const phone = phoneBlock()[0];
  assert.match(phone, /\.detail-modal\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(phone, /\.detail-modal\s*\{[^}]*width:\s*100vw/);
  assert.match(phone, /\.detail-modal\s*\{[^}]*border-radius:\s*0/);
  assert.match(phone, /\.detail-actions\s*\{[^}]*width:\s*100%/);
  assert.match(phone, /\.detail-back-btn\s*\{[^}]*margin-right:\s*auto/);
  for (const id of ['detail-fullscreen-btn', 'detail-close', 'detail-copy-btn']) {
    assert.match(phone, new RegExp(String.raw`#${id}[^{]*\{[^}]*display:\s*none`), id);
  }
  assert.doesNotMatch(phone, /!important/);
});

test('the back button does what the close button does: the address loses card= and the popup closes', async () => {
  const back = control();
  const close = control();
  const page = loadPage({
    board: { projectName: 'kanban', statuses: ['todo'], priorities: ['Normal'], assignees: [], tags: [], types: [], notifications: [], active: [], archived: [] },
    search: '?card=3',
    elements: { '#detail-back-btn': back, '#detail-close': close },
  });
  const pushed = [];
  page.ctx.history = { pushState: (s, t, url) => pushed.push(url) };
  await page.start();
  assert.ok((back.listeners.click || []).length > 0, 'the back button has a click listener');
  back.fire('click', {});
  const viaBack = pushed.splice(0);
  close.fire('click', {});
  assert.deepStrictEqual(viaBack, pushed.splice(0));
  assert.deepStrictEqual(viaBack, ['/']);
});
