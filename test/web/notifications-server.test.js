const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

const SAMPLE = `- id: 1
  at: 2026-07-08T23:40:00
  from: "workflow:#13-finalizer"
  message: "Card #13 closed."
  read: false
- id: 2
  at: 2026-07-09T06:15:00
  from: agent-batch2
  message: "Batch 2 done."
  read: true
`;

function tmpBoard({ withNotifications = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notif-srv-'));
  fs.writeFileSync(path.join(dir, '1.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n\nbody\n`);
  if (withNotifications) fs.writeFileSync(path.join(dir, 'notifications.md'), SAMPLE);
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

test('GET /api/board carries notifications parsed from notifications.md (rides the poll)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.strictEqual(data.notifications.length, 2);
    assert.strictEqual(data.notifications[0].message, 'Card #13 closed.');
    assert.strictEqual(data.notifications[0].read, false);
  });
});

test('GET /api/board returns notifications: [] when the file is absent', async () => {
  const dir = tmpBoard({ withNotifications: false });
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.notifications, []);
  });
});

test('a malformed entry is skipped, not fatal — board still 200s with the valid rest', async () => {
  const dir = tmpBoard({ withNotifications: false });
  fs.writeFileSync(path.join(dir, 'notifications.md'),
    '- id: garbage\n  message: "broken"\n- id: 3\n  at: 2026-07-09T07:00:00\n  from: ok\n  message: "still here"\n  read: false\n');
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.notifications.length, 1);
    assert.strictEqual(data.notifications[0].id, 3);
  });
});

test('POST /api/notifications/mark-read with ids marks those, without ids marks all — both persist', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    let res = await fetch(`${base}/api/notifications/mark-read`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [1] }),
    });
    assert.strictEqual(res.status, 200);
    let { notifications } = await res.json();
    assert.strictEqual(notifications.find((n) => n.id === 1).read, true);
    assert.match(fs.readFileSync(path.join(dir, 'notifications.md'), 'utf8'), /read: true/);

    res = await fetch(`${base}/api/notifications/mark-read`, { method: 'POST' });
    ({ notifications } = await res.json());
    assert.ok(notifications.every((n) => n.read === true));
  });
});

test('DELETE /api/notifications/:id removes one; DELETE /api/notifications clears all (file stays)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    let res = await fetch(`${base}/api/notifications/1`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).notifications.length, 1);

    res = await fetch(`${base}/api/notifications`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).notifications, []);
    assert.ok(fs.existsSync(path.join(dir, 'notifications.md')));
    const board = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(board.notifications, []);
  });
});

test('both DELETE routes archive instead of deleting — entries land in archived/notifications.md', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await fetch(`${base}/api/notifications/1`, { method: 'DELETE' });
    const archiveFile = path.join(dir, 'archived', 'notifications.md');
    assert.ok(fs.existsSync(archiveFile), 'archive created by the per-id route');
    assert.match(fs.readFileSync(archiveFile, 'utf8'), /Card #13 closed\./);

    await fetch(`${base}/api/notifications`, { method: 'DELETE' });
    const archived = fs.readFileSync(archiveFile, 'utf8');
    assert.match(archived, /Card #13 closed\./);
    assert.match(archived, /Batch 2 done\./);
  });
});

test('GET /api/board carries each entry\'s level, defaulting absent to info', async () => {
  const dir = tmpBoard({ withNotifications: false });
  fs.writeFileSync(path.join(dir, 'notifications.md'),
    '- id: 1\n  at: 2026-07-12T10:00:00\n  from: afk\n  level: error\n  message: "boom; more: details"\n  read: false\n' +
    '- id: 2\n  at: 2026-07-12T10:01:00\n  from: afk\n  message: "no level here"\n  read: false\n');
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.strictEqual(data.notifications.find((n) => n.id === 1).level, 'error');
    assert.strictEqual(data.notifications.find((n) => n.id === 2).level, 'info');
  });
});

test('GET /notifications.js serves the client module before app.js in the SPA html', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/notifications.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.match(await res.text(), /sortNotificationsDesc/);

    const html = await (await fetch(`${base}/`)).text();
    const notifIdx = html.indexOf('notifications.js');
    const appIdx = html.indexOf('app.js');
    assert.ok(notifIdx > -1, 'notifications.js referenced');
    assert.ok(notifIdx < appIdx, 'notifications.js loads before app.js');
  });
});
