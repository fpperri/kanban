const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sortNotificationsDesc, unreadCount, unseenUnread, splitTldr, splitNotification, notificationLevel } = require('../web/notifications');

const LIST = [
  { id: 1, at: '2026-07-08T23:40:00', from: 'a', message: 'oldest', read: false },
  { id: 3, at: '2026-07-09T06:15:00', from: 'b', message: 'newest', read: true },
  { id: 2, at: '2026-07-09T06:15:00', from: 'c', message: 'same time, lower id', read: false },
];

test('sortNotificationsDesc orders newest first, id-desc on timestamp ties, without mutating input', () => {
  const input = [...LIST];
  const sorted = sortNotificationsDesc(input);
  assert.deepStrictEqual(sorted.map((n) => n.id), [3, 2, 1]);
  assert.deepStrictEqual(input, LIST); // input untouched
});

test('unreadCount counts only read: false entries', () => {
  assert.strictEqual(unreadCount(LIST), 2);
  assert.strictEqual(unreadCount([]), 0);
});

test('unseenUnread returns unread entries not already seen this session', () => {
  const seen = new Set([1]);
  assert.deepStrictEqual(unseenUnread(LIST, seen).map((n) => n.id), [2]);
  assert.deepStrictEqual(unseenUnread(LIST, new Set()).map((n) => n.id), [1, 2]);
  assert.deepStrictEqual(unseenUnread(LIST, new Set([1, 2])), []);
});

// --- TLDR-first message shape --------------------------------------

test('splitTldr splits on the FIRST "; more: " — TLDR before, detail after', () => {
  assert.deepStrictEqual(splitTldr('Card #7 closed; more: 3 files touched, 12 tests added'),
    { tldr: 'Card #7 closed', more: '3 files touched, 12 tests added' });
});

test('splitTldr with no separator returns the whole message as TLDR', () => {
  assert.deepStrictEqual(splitTldr('Just a plain sentence.'), { tldr: 'Just a plain sentence.', more: '' });
});

test('splitTldr keeps later "; more: " occurrences inside the detail', () => {
  assert.deepStrictEqual(splitTldr('a; more: b; more: c'), { tldr: 'a', more: 'b; more: c' });
});

test('splitTldr tolerates empty, null, and undefined messages', () => {
  assert.deepStrictEqual(splitTldr(''), { tldr: '', more: '' });
  assert.deepStrictEqual(splitTldr(null), { tldr: '', more: '' });
  assert.deepStrictEqual(splitTldr(undefined), { tldr: '', more: '' });
});

test('splitTldr does not split on near-misses of the separator', () => {
  assert.deepStrictEqual(splitTldr('a;more: b'), { tldr: 'a;more: b', more: '' });
  assert.deepStrictEqual(splitTldr('a; more:b'), { tldr: 'a; more:b', more: '' });
});

// --- levels ---------------------------------------------------------

test('notificationLevel returns the entry level for the four legal values', () => {
  for (const level of ['debug', 'info', 'warning', 'error']) {
    assert.strictEqual(notificationLevel({ level }), level);
  }
});

test('notificationLevel defaults absent/unknown/nullish to info (back-compat)', () => {
  assert.strictEqual(notificationLevel({}), 'info');
  assert.strictEqual(notificationLevel({ level: 'shouting' }), 'info');
  assert.strictEqual(notificationLevel({ level: undefined }), 'info');
  assert.strictEqual(notificationLevel(null), 'info');
});

// --- render guard: the tray builds DOM nodes, never string HTML ---------------
// renderNotifList lives in app.js (DOM code, not require-able), so this pins
// the mechanism at source level: the TLDR goes through splitTldr into a
// <strong> node via textContent, and no notification field rides innerHTML.

test('app.js renders the tray via splitNotification + createElement/textContent, with level classes — no innerHTML for entry text', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = src.match(/function renderNotifList\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'renderNotifList found');
  assert.match(fn[0], /splitNotification\(/);
  assert.match(fn[0], /splitClauses\(/);
  assert.match(fn[0], /appendInline\(/);
  assert.match(fn[0], /notificationLevel\(/);
  assert.match(fn[0], /level-\$\{/);
  assert.ok(!fn[0].includes('innerHTML'), 'notification text must never be string-built HTML');
  const inline = src.match(/function appendInline\([\s\S]*?\n\}/);
  assert.ok(inline, 'appendInline found');
  assert.match(inline[0], /createElement\(tok\.t === 'code' \? 'code' : 'strong'\)/);
  assert.match(inline[0], /textContent = tok\.v/);
  assert.ok(!inline[0].includes('innerHTML'), 'inline marks are DOM nodes, never HTML');
});

// --- the tray's two parts --------------------------------------------------
test('splitNotification follows the contract: the TLDR is the text before the first "; more: "', () => {
  assert.deepStrictEqual(splitNotification('Card closed; more: 3 files touched; 12 tests added'),
    { tldr: 'Card closed', more: '3 files touched; 12 tests added' });
});

test('splitNotification falls back to the first sentence when the separator is missing, dropping a leading "more:" label', () => {
  assert.deepStrictEqual(splitNotification('Goals re-ranked for the week. more: nothing was moved; this is a report.'),
    { tldr: 'Goals re-ranked for the week.', more: 'nothing was moved; this is a report.' });
  assert.deepStrictEqual(splitNotification('Filed it. Then waited.'), { tldr: 'Filed it.', more: 'Then waited.' });
});

test('splitNotification leaves a one-sentence message whole, and tolerates empty input', () => {
  assert.deepStrictEqual(splitNotification('Just one sentence.'), { tldr: 'Just one sentence.', more: '' });
  assert.deepStrictEqual(splitNotification(null), { tldr: '', more: '' });
});

test('splitNotification does not end the first sentence inside code, quotes, parentheses or an abbreviation', () => {
  assert.strictEqual(splitNotification('Moved `v4/cortex. herd` into place. Done.').tldr, 'Moved `v4/cortex. herd` into place.');
  assert.strictEqual(splitNotification('It said "stop. now" and stopped. Next.').tldr, 'It said "stop. now" and stopped.');
  assert.strictEqual(splitNotification('Two cards (one filed. one moved) landed. Next.').tldr, 'Two cards (one filed. one moved) landed.');
  assert.strictEqual(splitNotification('Several fixes, e.g. the tray, shipped. Next.').tldr, 'Several fixes, e.g. the tray, shipped.');
});
