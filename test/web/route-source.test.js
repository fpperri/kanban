const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');

test('the board load names its source: the server, with nothing queued', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-route-source-'));
  try {
    fs.writeFileSync(path.join(dir, '1.card.md'), '---\nid: 1\nstatus: todo\n---\n\n# One\n');
    assert.deepStrictEqual(makeRoute(dir)('GET', '/api/board').body.source, { kind: 'server', queued: 0 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
