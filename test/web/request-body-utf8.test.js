const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// A request body arrives in chunks, and a chunk may end in the middle of a character that takes
// more than one byte. The server decodes the body as one stream, so such a character is never
// turned into two replacement characters.

function board() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-body-')));
  const dir = path.join(root, '.kanban');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\n---\n\n# One\n');
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'scratchpad: .scratchpad\n');
  return dir;
}

function putInTwoChunks(port, url, payload, cut) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method: 'PUT', headers: { 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(payload.subarray(0, cut));
    setTimeout(() => req.end(payload.subarray(cut)), 30);
  });
}

test('a character split across two chunks of a request body arrives whole', async () => {
  const dir = board();
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const text = `caf${String.fromCharCode(0xe9)} au lait`;
    const payload = Buffer.from(JSON.stringify({ body: text }), 'utf8');
    const cut = payload.indexOf(0xc3) + 1; // after the first byte of the two that make the accented e
    assert.ok(cut > 0 && payload[cut] === 0xa9);
    const status = await putInTwoChunks(srv.address().port, '/api/scratchpad/1', payload, cut);
    assert.strictEqual(status, 200);
    const page = fs.readFileSync(path.join(dir, '.scratchpad', '0001.scratchpad.md'), 'utf8');
    assert.ok(page.includes(text), JSON.stringify(page));
    assert.ok(!page.includes(String.fromCharCode(0xfffd)));
  } finally {
    srv.close();
  }
});
