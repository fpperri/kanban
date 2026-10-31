const { test } = require('node:test');
const assert = require('node:assert');
const { makeSaveGuard, asOfLabel } = require('../../plugin/skills/web/web/save-guard');

// The activity mark and the leaving guard read one counter of saves in flight; a downloaded file's guard
// also reads whether its queued changes have left the page by a copy or a save.

const later = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };

test('a save in flight is counted until it answers, and the page is told at each change', async () => {
  const seen = [];
  const guard = makeSaveGuard((n) => seen.push(n));
  const held = later();
  const tracked = guard.track(held.promise);
  assert.strictEqual(guard.inFlight(), 1);
  held.release('ok');
  assert.strictEqual(await tracked, 'ok');
  await Promise.resolve();
  assert.strictEqual(guard.inFlight(), 0);
  assert.deepStrictEqual(seen, [1, 0]);
});

test('a save the board refuses stops counting too, and its refusal still reaches the caller', async () => {
  const guard = makeSaveGuard();
  const refused = Promise.reject(new Error('422'));
  await assert.rejects(guard.track(refused), /422/);
  assert.strictEqual(guard.inFlight(), 0);
});

test('two saves in flight count two, and one answering leaves one', async () => {
  const guard = makeSaveGuard();
  const a = later();
  const b = later();
  guard.track(a.promise);
  guard.track(b.promise);
  assert.strictEqual(guard.inFlight(), 2);
  a.release();
  await a.promise;
  await Promise.resolve();
  assert.strictEqual(guard.inFlight(), 1);
});

test('leaving asks while a save is in flight, on every source', () => {
  const guard = makeSaveGuard();
  guard.track(new Promise(() => {}));
  for (const kind of ['server', 'page', 'artifact']) assert.strictEqual(guard.leaving({ kind, queued: 0 }), 'saving');
});

test('leaving asks for a file whose queue is longer than the last copy or save, and for nothing else', () => {
  const guard = makeSaveGuard();
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 0 }), null);
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 2 }), 'unsent');
  guard.sent(2);
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 2 }), null);
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 3 }), 'unsent');
});

test('the desk and a Board artifact keep their changes elsewhere, so only a save in flight asks', () => {
  const guard = makeSaveGuard();
  assert.strictEqual(guard.leaving({ kind: 'server', queued: 0 }), null);
  assert.strictEqual(guard.leaving({ kind: 'artifact', queued: 5 }), null);
  assert.strictEqual(guard.leaving(null), null);
});

test('a copy that covered fewer changes than are queued leaves the rest unsent', () => {
  const guard = makeSaveGuard();
  guard.sent(1);
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 2 }), 'unsent');
  guard.sent(2);
  guard.sent(1);
  assert.strictEqual(guard.leaving({ kind: 'page', queued: 2 }), null);
});

test('Refresh in a page reads "Board as of <time>" in local time, with the date when the Base is not today', () => {
  const base = new Date(2026, 9, 31, 9, 5, 0);
  assert.strictEqual(asOfLabel(base.toISOString(), new Date(2026, 9, 31, 20, 0, 0)), 'Board as of 09:05');
  assert.strictEqual(asOfLabel(base.toISOString(), new Date(2026, 10, 2, 8, 0, 0)), 'Board as of 2026-10-31 09:05');
});

test('a Base that is no date gives no label, so Refresh keeps its word', () => {
  assert.strictEqual(asOfLabel(undefined), null);
  assert.strictEqual(asOfLabel('soon'), null);
});

test('the page asks before it goes: askBeforeLeaving is the beforeunload listener while there is something to ask about, and the script is in the page', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  assert.ok(/addEventListener\('beforeunload', askBeforeLeaving\)/.test(fs.readFileSync(path.join(web, 'app.js'), 'utf8')));
  assert.ok(fs.readFileSync(path.join(web, 'app.html'), 'utf8').includes('<script src="/save-guard.js"></script>'));
});
