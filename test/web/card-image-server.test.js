const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// GET /api/cards/<id>/image?path=<path as the body wrote it>: the file of a card's Markdown image,
// found against the board folder, sent only when it is a png, jpg, gif or webp inside the folder that
// holds the board folder or the card's own scratchpad folder.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const SECRET = Buffer.from('top secret');

function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-img-')));
  const project = path.join(root, 'project');
  const dir = path.join(project, '.kanban');
  fs.mkdirSync(path.join(dir, 'archived', 'old'), { recursive: true });
  const card = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Card ${id}\n\nbody\n`;
  fs.writeFileSync(path.join(dir, '1.card.md'), card(1));
  fs.writeFileSync(path.join(dir, '2.card.md'), card(2));
  fs.writeFileSync(path.join(dir, 'archived', 'old', '3.card.md'), card(3).replace('todo', 'done'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'scratchpad: ../../pads/<card>\n');
  fs.mkdirSync(path.join(project, 'shots', 'item 12'), { recursive: true });
  fs.writeFileSync(path.join(project, 'shots', 'a.png'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'item 12', 'b.PNG'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'c.jpg'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'd.jpeg'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'e.gif'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'f.webp'), PNG);
  fs.writeFileSync(path.join(project, 'shots', 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  fs.writeFileSync(path.join(project, 'shots', 'notes.txt'), 'plain');
  fs.mkdirSync(path.join(project, 'shots', 'dir.png'));
  fs.mkdirSync(path.join(root, 'pads', '1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pads', '2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pads', '1', 'mine.png'), PNG);
  fs.writeFileSync(path.join(root, 'pads', '2', 'theirs.png'), PNG);
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'outside', 'secret.png'), SECRET);
  fs.writeFileSync(path.join(root, 'outside', 'secret.txt'), SECRET);
  fs.mkdirSync(path.join(root, 'project-evil'));
  fs.writeFileSync(path.join(root, 'project-evil', 'sibling.png'), SECRET);
  return { root, project, dir };
}

async function withBoard(fn) {
  const l = layout();
  const srv = createServer(l.dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = (id, p) => fetch(`${base}/api/cards/${id}/image?path=${encodeURIComponent(p)}`);
  try { return await fn({ ...l, base, get }); } finally { srv.close(); }
}

async function assertSendsNothing(res, why) {
  assert.ok(res.status >= 400 && res.status < 500, `${why}: ${res.status}`);
  assert.ok(!(res.headers.get('content-type') || '').startsWith('image/'), `${why}: no image type`);
  const text = Buffer.from(await res.arrayBuffer()).toString();
  assert.ok(!text.includes('top secret') && !text.includes('alert(1)') && !text.includes('plain'), `${why}: no file bytes`);
}

test('a png in the folder that holds the board folder is sent with its type, nosniff and its bytes', () => withBoard(async ({ get }) => {
  const res = await get(1, '../shots/a.png');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), PNG);
}));

test('the path is read against the board folder, so an archived card in a package finds the same file', () => withBoard(async ({ get }) => {
  const res = await get(3, '../shots/a.png');
  assert.strictEqual(res.status, 200);
  await res.arrayBuffer();
}));

test('a percent-encoded path is decoded once, and the extension is read in any case', () => withBoard(async ({ get }) => {
  const res = await get(1, '../shots/item%2012/b.PNG');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  await res.arrayBuffer();
  const spaced = await get(1, '../shots/item 12/b.PNG');
  assert.strictEqual(spaced.status, 200, 'a path that is already plain still finds its file');
  await spaced.arrayBuffer();
}));

test('each of the four types has its own content type', () => withBoard(async ({ get }) => {
  for (const [name, type] of [['c.jpg', 'image/jpeg'], ['d.jpeg', 'image/jpeg'], ['e.gif', 'image/gif'], ['f.webp', 'image/webp']]) {
    const res = await get(1, `../shots/${name}`);
    assert.strictEqual(res.status, 200, name);
    assert.strictEqual(res.headers.get('content-type'), type, name);
    await res.arrayBuffer();
  }
}));

test('a card finds a file in its own scratchpad folder, wherever the path puts it, and not in another card\'s', () => withBoard(async ({ get }) => {
  const mine = await get(1, '../../pads/1/mine.png');
  assert.strictEqual(mine.status, 200);
  await mine.arrayBuffer();
  await assertSendsNothing(await get(1, '../../pads/2/theirs.png'), 'another card\'s scratchpad folder');
  const theirs = await get(2, '../../pads/2/theirs.png');
  assert.strictEqual(theirs.status, 200);
  await theirs.arrayBuffer();
}));

// config.yaml paths are often written with Windows separators; <card> is found in either.
test('a scratchpad path written with backslashes keeps each card to its own folder', () => withBoard(async ({ get, dir }) => {
  const bs = String.fromCharCode(92);
  fs.writeFileSync(path.join(dir, 'config.yaml'), ['scratchpad: ..', '..', 'pads', '<card>', ''].join(bs) + '\n');
  const mine = await get(1, '../../pads/1/mine.png');
  assert.strictEqual(mine.status, 200);
  await mine.arrayBuffer();
  await assertSendsNothing(await get(1, '../../pads/2/theirs.png'), "another card's scratchpad folder, backslash config");
}));

test('climbing out of both roots is refused', () => withBoard(async ({ get }) => {
  await assertSendsNothing(await get(1, '../../outside/secret.png'), 'dot-dot out of the project');
  await assertSendsNothing(await get(1, '../shots/../../outside/secret.png'), 'dot-dot after a folder');
  await assertSendsNothing(await get(1, '../../../../../../../../../../../../outside/secret.png'), 'dot-dot to the drive root');
  await assertSendsNothing(await get(1, '..%2F..%2Foutside%2Fsecret.png'), 'an escaped slash decodes once and is judged as the path it names');
}));

test('a sibling folder whose name starts like the root is outside it', () => withBoard(async ({ get }) => {
  await assertSendsNothing(await get(1, '../../project-evil/sibling.png'), 'project-evil beside project');
}));

test('an absolute path elsewhere is refused, and one inside the root is allowed', () => withBoard(async ({ get, root, project }) => {
  await assertSendsNothing(await get(1, path.join(root, 'outside', 'secret.png')), 'an absolute path outside');
  await assertSendsNothing(await get(1, '/etc/passwd.png'), 'a unix absolute path');
  const inside = await get(1, path.join(project, 'shots', 'a.png'));
  assert.strictEqual(inside.status, 200);
  await inside.arrayBuffer();
}));

test('a symlink or junction pointing out of the roots is refused', (t) => withBoard(async ({ get, root, project }) => {
  fs.symlinkSync(path.join(root, 'outside'), path.join(project, 'shots', 'door'), 'junction');
  await assertSendsNothing(await get(1, '../shots/door/secret.png'), 'a linked folder');
  let file = true;
  try { fs.symlinkSync(path.join(root, 'outside', 'secret.png'), path.join(project, 'shots', 'link.png'), 'file'); } catch (_) { file = false; }
  if (!file) { t.diagnostic('file symlinks need a privilege this machine lacks: the linked-file checks did not run'); return; }
  await assertSendsNothing(await get(1, '../shots/link.png'), 'a linked file');
  fs.symlinkSync(path.join(root, 'outside', 'secret.txt'), path.join(project, 'shots', 'inside.png'), 'file');
  await assertSendsNothing(await get(1, '../shots/inside.png'), 'a .png link to a file of another type');
}));

// A path outside both roots is refused before the file system is asked about it: on Windows a
// realpath or a stat of a UNC path (two backslashes, a host, a share) opens an SMB connection to that host.
test('a path outside the roots, a network share included, is refused without touching the file system', () => withBoard(async ({ get }) => {
  const asked = [];
  const { realpathSync, statSync } = fs;
  const native = realpathSync.native;
  const note = (p) => { if (String(p).includes('evilhost')) asked.push(String(p)); };
  fs.realpathSync.native = (p, ...rest) => { note(p); return native(p, ...rest); };
  fs.statSync = (p, ...rest) => { note(p); return statSync(p, ...rest); };
  try {
    const paths = ['//evilhost/share/a.png'];
    const bs = String.fromCharCode(92);
    if (process.platform === 'win32') paths.push(`${bs}${bs}evilhost${bs}share${bs}a.png`, `${bs}${bs}?${bs}UNC${bs}evilhost${bs}share${bs}a.png`);
    for (const p of paths) await assertSendsNothing(await get(1, p), p);
  } finally {
    fs.realpathSync.native = native;
    fs.statSync = statSync;
  }
  assert.deepStrictEqual(asked, []);
}));

test('svg, text and every other type are refused, and so is a folder or a card file', () => withBoard(async ({ get }) => {
  await assertSendsNothing(await get(1, '../shots/x.svg'), 'svg');
  await assertSendsNothing(await get(1, '../shots/notes.txt'), 'txt');
  await assertSendsNothing(await get(1, '../shots/a.png.txt'), 'a png name that ends in txt');
  await assertSendsNothing(await get(1, '../shots'), 'a folder');
  await assertSendsNothing(await get(1, '1.card.md'), 'a card file');
}));

test('a missing file, a directory named like an image and an empty or absent path send nothing', () => withBoard(async ({ get, base }) => {
  await assertSendsNothing(await get(1, '../shots/nope.png'), 'a missing file');
  await assertSendsNothing(await get(1, '../shots/dir.png'), 'a directory');
  await assertSendsNothing(await get(1, ''), 'an empty path');
  await assertSendsNothing(await fetch(`${base}/api/cards/1/image`), 'no path');
  await assertSendsNothing(await get(1, '../shots/a.png\0.txt'), 'a NUL');
}));

test('a malformed percent escape is refused', () => withBoard(async ({ get }) => {
  for (const bad of ['../shots/%zz.png', '../shots/a%.png', '../shots/%E0%A4%A.png']) await assertSendsNothing(await get(1, bad), bad);
}));

test('a card that is not on the board has no picture to send, and a write method has no route', () => withBoard(async ({ get, base }) => {
  const missing = await get(99, '../shots/a.png');
  assert.strictEqual(missing.status, 404);
  await missing.arrayBuffer();
  const post = await fetch(`${base}/api/cards/1/image?path=${encodeURIComponent('../shots/a.png')}`, { method: 'POST', body: '{}' });
  assert.ok(post.status >= 400);
  await post.arrayBuffer();
}));

test('the page\'s content security policy still lets images come from the board server alone', () => withBoard(async ({ base }) => {
  const res = await fetch(`${base}/`);
  assert.ok(res.headers.get('content-security-policy').includes("img-src 'self';"));
  await res.arrayBuffer();
}));

test('the route is named in the web skill\'s api reference', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'references', 'api.md'), 'utf8');
  assert.ok(api.includes('GET /api/cards/<id>/image?path='));
});
