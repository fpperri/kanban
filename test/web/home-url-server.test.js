const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createServer, parseHomeUrl, extractHomeUrlArg } = require('../../plugin/skills/web/scripts/server');

const SERVER = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'server.js');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-home-'));
  fs.writeFileSync(path.join(dir, '1.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n');
  return dir;
}

async function board(dir, homeUrl) {
  const srv = createServer(dir, undefined, homeUrl);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/board`);
    return await res.json();
  } finally { srv.close(); }
}

test('parseHomeUrl accepts http and https and returns the parsed address', () => {
  assert.strictEqual(parseHomeUrl('http://127.0.0.1:7791/'), 'http://127.0.0.1:7791/');
  assert.strictEqual(parseHomeUrl('  https://example.test/shop?x=1 '), 'https://example.test/shop?x=1');
});

test('parseHomeUrl refuses anything that is not http or https', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://x/', 'not a url', '', '/relative']) {
    assert.throws(() => parseHomeUrl(bad), /--home-url/, bad);
  }
});

test('extractHomeUrlArg understands both spellings and keeps the other arguments in order', () => {
  assert.deepStrictEqual(extractHomeUrlArg(['.kanban', '7777']), { homeUrl: undefined, rest: ['.kanban', '7777'] });
  assert.deepStrictEqual(extractHomeUrlArg(['.kanban', '--home-url', 'http://a/', '7777']), { homeUrl: 'http://a/', rest: ['.kanban', '7777'] });
  assert.deepStrictEqual(extractHomeUrlArg(['--home-url=http://a/', '.kanban']), { homeUrl: 'http://a/', rest: ['.kanban'] });
});

test('extractHomeUrlArg refuses a flag with no value', () => {
  assert.throws(() => extractHomeUrlArg(['.kanban', '--home-url']), /--home-url requires a value/);
  assert.throws(() => extractHomeUrlArg(['--home-url=']), /--home-url requires a value/);
});

test('GET /api/board carries homeUrl when the server was given one', async () => {
  const b = await board(tmpBoard(), 'http://127.0.0.1:7791/');
  assert.strictEqual(b.homeUrl, 'http://127.0.0.1:7791/');
});

test('GET /api/board has a null homeUrl when none was given', async () => {
  const b = await board(tmpBoard());
  assert.strictEqual(b.homeUrl, null);
});

test('the CLI stops at startup on a non-http(s) home url, with a message and a non-zero exit', () => {
  const dir = tmpBoard();
  for (const args of [['--home-url', 'javascript:alert(1)'], ['--home-url=data:text/html,x'], ['--home-url']]) {
    const r = spawnSync(process.execPath, [SERVER, dir, '0', ...args], { encoding: 'utf8', timeout: 15000 });
    assert.notStrictEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /--home-url/, args.join(' '));
  }
});

test('parseHomeUrl refuses an address carrying credentials', () => {
  for (const bad of ['http://user:pw@h.example/', 'https://user@h.example/', 'http://:pw@h.example/']) {
    assert.throws(() => parseHomeUrl(bad), /--home-url/, bad);
  }
});
