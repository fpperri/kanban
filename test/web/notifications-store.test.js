const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ns = require('../scripts/notifications-store');

function tmpBoard() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notif-'));
}

const SAMPLE = `- id: 1
  at: 2026-07-08T23:40:00
  from: "workflow:#13-finalizer"
  message: "Card #13 closed - clipboard click-test pending."
  read: false
- id: 2
  at: 2026-07-09T06:15:00
  from: agent-batch2
  message: "Batch 2 done, 172/172 green."
  read: true
`;

test('parseNotifications reads a well-formed two-entry list', () => {
  const list = ns.parseNotifications(SAMPLE);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[0], {
    id: 1,
    at: '2026-07-08T23:40:00',
    from: 'workflow:#13-finalizer',
    level: 'info',
    message: 'Card #13 closed - clipboard click-test pending.',
    read: false,
  });
  assert.strictEqual(list[1].read, true);
  assert.strictEqual(list[1].from, 'agent-batch2');
});

test('parseNotifications strips matching quotes and unescapes \\" and \\\\ in values', () => {
  const list = ns.parseNotifications(
    '- id: 3\n  at: 2026-07-09T07:00:00\n  from: "a"\n  message: "say \\"hi\\" and a back\\\\slash"\n  read: false\n'
  );
  assert.strictEqual(list[0].message, 'say "hi" and a back\\slash');
});

test('parseNotifications on empty or whitespace text returns []', () => {
  assert.deepStrictEqual(ns.parseNotifications(''), []);
  assert.deepStrictEqual(ns.parseNotifications('   \n\n'), []);
});

test('parseNotifications skips malformed entries but keeps valid ones', () => {
  const text =
    '- id: not-a-number\n  message: "broken id"\n' +
    '- at: 2026-07-09T01:00:00\n  from: x\n  read: false\n' + // no id, no message
    '- id: 7\n  at: 2026-07-09T02:00:00\n  from: ok\n  message: "valid"\n  read: false\n' +
    'random garbage line outside any entry\n' +
    '- id: 8\n  message: ""\n  read: false\n'; // empty message -> malformed
  const list = ns.parseNotifications(text);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 7);
});

test('parseNotifications defaults read to false, at/from to empty string, and level to info when omitted (back-compat)', () => {
  const list = ns.parseNotifications('- id: 4\n  message: "bare minimum"\n');
  assert.deepStrictEqual(list[0], { id: 4, at: '', from: '', level: 'info', message: 'bare minimum', read: false });
});

test('serializeNotifications round-trips through parseNotifications', () => {
  const list = ns.parseNotifications(SAMPLE);
  const text = ns.serializeNotifications(list);
  assert.deepStrictEqual(ns.parseNotifications(text), list);
});

test('serializeNotifications quotes strings so colons and hashes survive the round-trip', () => {
  const entry = [{ id: 5, at: '2026-07-09T03:00:00', from: 'wf: #9', level: 'info', message: 'tag: [a, b] # not a comment', read: false }];
  assert.deepStrictEqual(ns.parseNotifications(ns.serializeNotifications(entry)), entry);
});

test('level survives a serialize→parse round-trip for every legal value', () => {
  for (const level of ['debug', 'info', 'warning', 'error']) {
    const entry = [{ id: 6, at: '2026-07-12T10:00:00', from: 'afk-run:#131', level, message: 'leveled', read: false }];
    assert.deepStrictEqual(ns.parseNotifications(ns.serializeNotifications(entry)), entry);
  }
});

test('an unknown or absent level normalizes to info on parse AND on serialize', () => {
  assert.strictEqual(ns.parseNotifications('- id: 7\n  level: shouting\n  message: "x"\n')[0].level, 'info');
  assert.strictEqual(ns.parseNotifications('- id: 7\n  message: "x"\n')[0].level, 'info');
  assert.match(ns.serializeNotifications([{ id: 7, at: '', from: '', message: 'x', read: false }]), /^ {2}level: info$/m);
  assert.match(ns.serializeNotifications([{ id: 7, at: '', from: '', level: 'nope', message: 'x', read: false }]), /^ {2}level: info$/m);
});

test('readNotifications returns [] when notifications.md is absent', () => {
  const dir = tmpBoard();
  assert.deepStrictEqual(ns.readNotifications(dir), []);
});

test('readNotifications parses an existing notifications.md', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  assert.strictEqual(ns.readNotifications(dir).length, 2);
});

test('markRead with ids marks only those entries and persists', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  const updated = ns.markRead(dir, [1]);
  assert.strictEqual(updated.find((n) => n.id === 1).read, true);
  assert.deepStrictEqual(ns.readNotifications(dir), updated);
});

test('markRead without ids marks everything read', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  const updated = ns.markRead(dir);
  assert.ok(updated.every((n) => n.read === true));
  assert.ok(ns.readNotifications(dir).every((n) => n.read === true));
});

test('removeNotification deletes exactly one entry and persists; unknown id is a no-op', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  ns.removeNotification(dir, 1);
  const after = ns.readNotifications(dir);
  assert.strictEqual(after.length, 1);
  assert.strictEqual(after[0].id, 2);
  ns.removeNotification(dir, 999);
  assert.strictEqual(ns.readNotifications(dir).length, 1);
});

test('clearNotifications empties the list but leaves the file present', () => {
  const dir = tmpBoard();
  const file = path.join(dir, 'notifications.md');
  fs.writeFileSync(file, SAMPLE);
  ns.clearNotifications(dir);
  assert.deepStrictEqual(ns.readNotifications(dir), []);
  assert.ok(fs.existsSync(file));
});

test('mutations on a board with no notifications.md do not throw and do not create phantom entries', () => {
  const dir = tmpBoard();
  assert.deepStrictEqual(ns.markRead(dir), []);
  assert.doesNotThrow(() => ns.removeNotification(dir, 1));
  assert.doesNotThrow(() => ns.clearNotifications(dir));
  assert.deepStrictEqual(ns.readNotifications(dir), []);
  assert.ok(!fs.existsSync(path.join(dir, 'archived', 'notifications.md')), 'no phantom archive either');
});

// --- clear = archive — removed entries MOVE to archived/notifications.md

function archivePath(dir) {
  return path.join(dir, 'archived', 'notifications.md');
}

test('removeNotification appends the removed entry verbatim to archived/notifications.md, creating dir+file', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  ns.removeNotification(dir, 1);
  const archived = fs.readFileSync(archivePath(dir), 'utf8');
  assert.ok(archived.includes('- id: 1\n  at: 2026-07-08T23:40:00\n  from: "workflow:#13-finalizer"\n  message: "Card #13 closed - clipboard click-test pending."\n  read: false\n'), 'raw block preserved verbatim');
  assert.ok(!archived.includes('Batch 2 done'), 'the kept entry did not leak into the archive');
  assert.strictEqual(ns.readNotifications(dir).length, 1);
});

test('clearNotifications moves every entry to the archive; a second clear APPENDS instead of overwriting', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  ns.clearNotifications(dir);
  let archived = fs.readFileSync(archivePath(dir), 'utf8');
  assert.ok(archived.includes('Card #13 closed') && archived.includes('Batch 2 done'));
  fs.writeFileSync(path.join(dir, 'notifications.md'),
    '- id: 3\n  at: 2026-07-10T08:00:00\n  from: x\n  level: warning\n  message: "second wave"\n  read: false\n');
  ns.clearNotifications(dir);
  archived = fs.readFileSync(archivePath(dir), 'utf8');
  assert.ok(archived.includes('Card #13 closed'), 'first wave still archived');
  assert.ok(archived.includes('level: warning\n  message: "second wave"'), 'second wave appended, level line intact');
});

test('archived entries survive with their level field and stay parseable', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'),
    '- id: 9\n  at: 2026-07-12T09:00:00\n  from: afk\n  level: error\n  message: "boom; more: stack trace"\n  read: true\n');
  ns.removeNotification(dir, 9);
  const parsed = ns.parseNotifications(fs.readFileSync(archivePath(dir), 'utf8'));
  assert.deepStrictEqual(parsed, [{ id: 9, at: '2026-07-12T09:00:00', from: 'afk', level: 'error', message: 'boom; more: stack trace', read: true }]);
  assert.deepStrictEqual(ns.readNotifications(dir), []);
});

test('malformed blocks a rewrite would drop are archived, not deleted — the markRead path included', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'),
    '- id: not-a-number\n  message: "broken id"\n' + SAMPLE);
  ns.markRead(dir);
  const archived = fs.readFileSync(archivePath(dir), 'utf8');
  assert.ok(archived.includes('- id: not-a-number\n  message: "broken id"\n'), 'malformed block moved verbatim');
  assert.ok(!archived.includes('Card #13 closed'), 'valid entries stayed live on a read-flip');
  assert.strictEqual(ns.readNotifications(dir).length, 2);
});

test('markRead flips stay in-place — no archive file appears when nothing is dropped', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  ns.markRead(dir, [1]);
  assert.ok(!fs.existsSync(archivePath(dir)), 'a pure read-flip archives nothing');
  assert.strictEqual(ns.readNotifications(dir).find((n) => n.id === 1).read, true);
});

test('removeNotification of an unknown id archives nothing', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  ns.removeNotification(dir, 999);
  assert.ok(!fs.existsSync(archivePath(dir)));
  assert.strictEqual(ns.readNotifications(dir).length, 2);
});
