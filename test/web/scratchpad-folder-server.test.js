const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// The Scratchpad tab's folder browser through the server's HTTP API: the files of a card's own scratchpad
// folder (the `scratchpad:` path holds <card>), read one level at a time, and .md and .txt files created,
// saved, deleted, renamed and moved there. Everything is scoped to that one folder.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const card = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Card ${id}\n`;

function layout(config = 'scratchpad: ../pads/<card>\n') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-padfolder-')));
  const dir = path.join(root, 'project', '.kanban');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), card(1));
  fs.writeFileSync(path.join(dir, '0002.two.card.md'), card(2));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  const mine = path.join(root, 'project', 'pads', '1');
  const theirs = path.join(root, 'project', 'pads', '2');
  fs.mkdirSync(path.join(mine, 'sub'), { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'outside', 'secret.txt'), 'top secret');
  fs.writeFileSync(path.join(mine, '0001.scratchpad.md'), '---\nrefs:\n  - a\n---\n\npage body\n');
  fs.writeFileSync(path.join(mine, 'shot.png'), PNG);
  fs.writeFileSync(path.join(mine, 'notes.md'), '# Notes\n\nhello\n');
  fs.writeFileSync(path.join(mine, 'log.txt'), 'line one\n');
  fs.writeFileSync(path.join(mine, 'run.log'), 'a log line\n');
  fs.writeFileSync(path.join(mine, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0]));
  fs.writeFileSync(path.join(mine, 'sub', 'inner.md'), 'inner\n');
  fs.writeFileSync(path.join(theirs, 'theirs.txt'), 'theirs');
  return { root, dir, mine, theirs };
}

async function withBoard(fn, config) {
  const l = layout(config);
  const srv = createServer(l.dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* plain */ }
    return { status: res.status, json, text };
  };
  const q = (id, p) => `/api/scratchpad/${id}/${p}`;
  const list = (id, rel = '') => call('GET', `${q(id, 'files')}?path=${encodeURIComponent(rel)}`);
  const open = (id, rel) => call('GET', `${q(id, 'file')}?path=${encodeURIComponent(rel)}`);
  try { return await fn({ ...l, call, q, list, open }); } finally { srv.close(); }
}

// Every path, size and mtime under a folder: a refusal sweep must leave the tree as it found it.
function snapshot(root) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const f = path.join(d, name);
      const st = fs.lstatSync(f);
      out.push(`${path.relative(root, f)}|${st.isDirectory() ? 'dir' : st.size}|${st.mtimeMs}`);
      if (st.isDirectory()) walk(f);
    }
  };
  walk(root);
  return out;
}

const refused = (r, why) => {
  assert.ok(r.status >= 400 && r.status < 500, `${why}: ${r.status}`);
  assert.ok(!r.text.includes('top secret'), `${why}: no secret bytes`);
};

test('the list names the folder, the page first, then folders, then files, each with size and date', () => withBoard(async ({ list, mine }) => {
  const r = await list(1);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.folder, mine);
  assert.strictEqual(r.json.path, '');
  assert.strictEqual(r.json.parent, null);
  assert.deepStrictEqual(r.json.entries.map((e) => e.name), ['0001.scratchpad.md', 'sub', 'blob.bin', 'log.txt', 'notes.md', 'run.log', 'shot.png']);
  const [page, sub, blob, log, notes, , shot] = r.json.entries;
  assert.strictEqual(page.page, true);
  assert.strictEqual(page.writable, false);
  assert.strictEqual(sub.dir, true);
  assert.strictEqual(sub.path, 'sub');
  assert.strictEqual(blob.size, 5);
  assert.ok(!Number.isNaN(Date.parse(blob.mtime)));
  assert.strictEqual(log.kind, 'text');
  assert.strictEqual(log.writable, true);
  assert.strictEqual(notes.kind, 'markdown');
  assert.strictEqual(shot.kind, 'image');
  assert.strictEqual(shot.writable, false);
  assert.strictEqual(shot.abs, path.join(mine, 'shot.png'));
}));

test('a click on a folder lists it one level down, with a way back up', () => withBoard(async ({ list }) => {
  const r = await list(1, 'sub');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.path, 'sub');
  assert.strictEqual(r.json.parent, '');
  assert.deepStrictEqual(r.json.entries.map((e) => e.path), ['sub/inner.md']);
}));

test('a card with no folder yet lists nothing; another card sees only its own folder', () => withBoard(async ({ call, q, theirs, list }) => {
  fs.rmSync(theirs, { recursive: true });
  const r = await list(2);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.entries, []);
  const mine = await list(1);
  assert.ok(!mine.json.entries.some((e) => e.name === 'theirs.txt'));
  refused(await call('GET', `${q(1, 'file')}?path=${encodeURIComponent('../2/theirs.txt')}`), "the other card's folder");
}));

test('without <card> in the scratchpad path every route is a 404 and the page stays as it is', () => withBoard(async ({ call, q, list, open }) => {
  assert.strictEqual((await list(1)).status, 404);
  assert.strictEqual((await open(1, 'notes.md')).status, 404);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'n.md', text: 'x' })).status, 404);
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'd' })).status, 404);
  assert.strictEqual((await call('GET', '/api/scratchpad/1')).status, 200);
}, 'scratchpad: ../pads\n'));

test('with the scratchpad off every route is a 404', () => withBoard(async ({ list }) => {
  assert.strictEqual((await list(1)).status, 404);
}, 'name: t\n'));

test('a bad id is refused', () => withBoard(async ({ call }) => {
  const r = await call('GET', '/api/scratchpad/abc/files');
  assert.ok(r.status === 400 || r.status === 404);
}));

test('opening a markdown file gives its text and version; a text file the same; an image gives its path', () => withBoard(async ({ open, mine }) => {
  const md = await open(1, 'notes.md');
  assert.strictEqual(md.status, 200);
  assert.strictEqual(md.json.file.kind, 'markdown');
  assert.strictEqual(md.json.file.text, '# Notes\n\nhello\n');
  assert.strictEqual(md.json.file.writable, true);
  assert.match(md.json.file.version, /^[0-9a-f]{16}$/);
  assert.strictEqual(md.json.file.base, mine);
  assert.strictEqual(md.json.file.dir, false);
  const txt = await open(1, 'run.log');
  assert.strictEqual(txt.json.file.kind, 'text');
  assert.strictEqual(txt.json.file.text, 'a log line\n');
  assert.strictEqual(txt.json.file.writable, false);
  const img = await open(1, 'shot.png');
  assert.strictEqual(img.json.file.kind, 'image');
  assert.strictEqual(img.json.file.text, undefined);
  assert.strictEqual(img.json.file.abs, path.join(mine, 'shot.png'));
}));

test('a binary file, and a text file over the cap, open as other: name, size, path and no text', () => withBoard(async ({ open, mine }) => {
  const bin = await open(1, 'blob.bin');
  assert.strictEqual(bin.json.file.kind, 'other');
  assert.strictEqual(bin.json.file.size, 5);
  assert.strictEqual(bin.json.file.text, undefined);
  fs.writeFileSync(path.join(mine, 'big.txt'), 'x'.repeat(300001));
  const big = await open(1, 'big.txt');
  assert.strictEqual(big.status, 200);
  assert.strictEqual(big.json.file.kind, 'other');
  assert.strictEqual(big.json.file.tooLarge, true);
  assert.strictEqual(big.json.file.text, undefined);
}));

test('opening a folder or a missing file is a 404', () => withBoard(async ({ open }) => {
  assert.strictEqual((await open(1, 'sub')).status, 404);
  assert.strictEqual((await open(1, 'nope.md')).status, 404);
}));

test('a path that climbs out, is absolute, names a drive or a share, or is not a name is refused on every route', () => withBoard(async ({ call, q, root, list, open }) => {
  const bad = ['../../outside/secret.txt', '..', 'sub/../../x.txt', '/etc/passwd', '//host/share/x.txt', '\\\\host\\share\\x.txt',
    'C:/Windows/win.ini', 'C:\\Windows\\win.ini', 'sub\\inner.md', 'a\0b.txt', './notes.md', 'sub//inner.md', 'x:y.txt'];
  const before = snapshot(root);
  for (const p of bad) {
    refused(await open(1, p), `open ${JSON.stringify(p)}`);
    refused(await list(1, p), `list ${JSON.stringify(p)}`);
    refused(await call('POST', q(1, 'file'), { path: p, text: 'x' }), `create ${JSON.stringify(p)}`);
    refused(await call('PUT', q(1, 'file'), { path: p, text: 'x', version: 'v' }), `save ${JSON.stringify(p)}`);
    refused(await call('DELETE', q(1, 'file'), { path: p, version: 'v' }), `delete ${JSON.stringify(p)}`);
    refused(await call('POST', q(1, 'move'), { from: 'notes.md', to: p }), `move to ${JSON.stringify(p)}`);
    refused(await call('POST', q(1, 'move'), { from: p, to: 'z.md' }), `move from ${JSON.stringify(p)}`);
    refused(await call('POST', q(1, 'folder'), { path: p }), `mkdir ${JSON.stringify(p)}`);
  }
  assert.deepStrictEqual(snapshot(root), before, 'the refusals wrote nothing');
}));

test('a link pointing out of the folder is refused to read, list, write into and delete through', () => withBoard(async ({ call, q, mine, root, list, open }) => {
  const link = path.join(mine, 'out');
  fs.symlinkSync(path.join(root, 'outside'), link, process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshot(root);
  refused(await list(1, 'out'), 'list through the link');
  refused(await open(1, 'out/secret.txt'), 'open through the link');
  refused(await call('POST', q(1, 'file'), { path: 'out/new.txt', text: 'x' }), 'create through the link');
  refused(await call('PUT', q(1, 'file'), { path: 'out/secret.txt', text: 'x', version: 'v' }), 'save through the link');
  refused(await call('DELETE', q(1, 'file'), { path: 'out/secret.txt', version: 'v' }), 'delete through the link');
  refused(await call('POST', q(1, 'move'), { from: 'notes.md', to: 'out/notes.md' }), 'move through the link');
  refused(await call('POST', q(1, 'folder'), { path: 'out/d' }), 'mkdir through the link');
  assert.deepStrictEqual(snapshot(root), before, 'the refusals wrote nothing');
  assert.ok(!(await list(1)).json.entries.some((e) => e.name === 'out'), 'the link is not listed');
}));

test('create writes a new .md or .txt file, and refuses what exists', () => withBoard(async ({ call, q, mine }) => {
  const r = await call('POST', q(1, 'file'), { path: 'new.txt', text: 'hi\n' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.file.path, 'new.txt');
  assert.strictEqual(r.json.file.text, 'hi\n');
  assert.strictEqual(fs.readFileSync(path.join(mine, 'new.txt'), 'utf8'), 'hi\n');
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'sub/deep.MD', text: '' })).status, 201);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'new.txt', text: 'again' })).status, 409);
  assert.strictEqual(fs.readFileSync(path.join(mine, 'new.txt'), 'utf8'), 'hi\n');
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'no/such/dir.md', text: 'x' })).status, 404);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'n.md', text: 5 })).status, 400);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'big.md', text: 'x'.repeat(300001) })).status, 413);
  assert.ok(!fs.existsSync(path.join(mine, 'big.md')));
}));

test('a card whose folder does not exist yet gets it made by its first file', () => withBoard(async ({ call, q, theirs, open }) => {
  fs.rmSync(theirs, { recursive: true });
  assert.strictEqual((await call('POST', q(2, 'file'), { path: 'first.md', text: 'x' })).status, 201);
  assert.strictEqual((await open(2, 'first.md')).json.file.text, 'x');
}));

test('create, save, delete and move refuse any name that is not .md or .txt, and any name the page uses', () => withBoard(async ({ call, q, mine }) => {
  for (const name of ['a.png', 'a.js', 'a', 'a.md.exe', '.md', 'a.txt.', 'a.md ', 'a.svg']) {
    const r = await call('POST', q(1, 'file'), { path: name, text: 'x' });
    assert.strictEqual(r.status, 400, `create ${name}: ${r.status}`);
    assert.ok(!fs.existsSync(path.join(mine, name.trim())), name);
  }
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: 'shot.png', text: 'x', version: 'v' })).status, 400);
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: 'run.log', text: 'x', version: 'v' })).status, 400);
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'shot.png', version: 'v' })).status, 400);
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'blob.bin', version: 'v' })).status, 400);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'shot.png', to: 'sub/shot.png' })).status, 400);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: 'notes.png' })).status, 400);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: 'notes.js' })).status, 400);
  assert.ok(fs.existsSync(path.join(mine, 'shot.png')) && fs.existsSync(path.join(mine, 'run.log')) && fs.existsSync(path.join(mine, 'notes.md')));
  assert.strictEqual((await call('POST', q(1, 'file'), { path: '0009.scratchpad.md', text: 'x' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: '0001.scratchpad.md' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: 'sub/5.scratchpad.md' })).status, 403);
}));

test('save writes the new text when the version is the one read, and answers the file as it now reads', () => withBoard(async ({ call, q, open, mine }) => {
  const { file } = (await open(1, 'notes.md')).json;
  const r = await call('PUT', q(1, 'file'), { path: 'notes.md', text: '# Changed\n', version: file.version });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.file.text, '# Changed\n');
  assert.notStrictEqual(r.json.file.version, file.version);
  assert.strictEqual(fs.readFileSync(path.join(mine, 'notes.md'), 'utf8'), '# Changed\n');
  assert.ok(!fs.existsSync(path.join(mine, 'notes.md.tmp')));
}));

test('save is a 409 when the file changed since it was read, and writes nothing', () => withBoard(async ({ call, q, open, mine }) => {
  const { file } = (await open(1, 'notes.md')).json;
  fs.writeFileSync(path.join(mine, 'notes.md'), 'edited elsewhere\n');
  const r = await call('PUT', q(1, 'file'), { path: 'notes.md', text: 'mine', version: file.version });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(fs.readFileSync(path.join(mine, 'notes.md'), 'utf8'), 'edited elsewhere\n');
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: 'notes.md', text: 'mine' })).status, 400);
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: 'gone.md', text: 'x', version: 'v' })).status, 404);
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: 'notes.md', text: 'x'.repeat(300001), version: file.version })).status, 413);
}));

test('save keeps a CRLF file in CRLF', () => withBoard(async ({ call, q, open, mine }) => {
  fs.writeFileSync(path.join(mine, 'crlf.txt'), 'a\r\nb\r\n');
  const { file } = (await open(1, 'crlf.txt')).json;
  assert.strictEqual(file.text, 'a\nb\n');
  await call('PUT', q(1, 'file'), { path: 'crlf.txt', text: 'a\nb\nc\n', version: file.version });
  assert.strictEqual(fs.readFileSync(path.join(mine, 'crlf.txt'), 'utf8'), 'a\r\nb\r\nc\r\n');
}));

test('delete names the version it read: removes the file on a match, a 409 on a change, a 400 without one', () => withBoard(async ({ call, q, open, mine }) => {
  const { file } = (await open(1, 'log.txt')).json;
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'log.txt' })).status, 400);
  fs.writeFileSync(path.join(mine, 'log.txt'), 'changed\n');
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'log.txt', version: file.version })).status, 409);
  assert.ok(fs.existsSync(path.join(mine, 'log.txt')));
  const fresh = (await open(1, 'log.txt')).json.file;
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'log.txt', version: fresh.version })).status, 200);
  assert.ok(!fs.existsSync(path.join(mine, 'log.txt')));
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'log.txt', version: fresh.version })).status, 404);
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'sub', version: 'v' })).status, 400);
  assert.ok(fs.existsSync(path.join(mine, 'sub')));
}));

test('the page itself cannot be deleted, renamed, moved, saved or overwritten through these routes', () => withBoard(async ({ call, q, mine }) => {
  const page = path.join(mine, '0001.scratchpad.md');
  const before = fs.readFileSync(page, 'utf8');
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: '0001.scratchpad.md', version: 'v' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: '0001.scratchpad.md', to: 'sub/0001.scratchpad.md' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: '0001.scratchpad.md', to: 'renamed.md' })).status, 403);
  assert.strictEqual((await call('PUT', q(1, 'file'), { path: '0001.scratchpad.md', text: 'x', version: 'v' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: '0001.scratchpad.md', text: 'x' })).status, 403);
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: '0001.SCRATCHPAD.MD', version: 'v' })).status, 403);
  assert.strictEqual(fs.readFileSync(page, 'utf8'), before);
}));

test('move renames a file, or moves it into an existing subfolder; an existing target is a 409 and a missing folder a 404', () => withBoard(async ({ call, q, mine }) => {
  const r = await call('POST', q(1, 'move'), { from: 'log.txt', to: 'renamed.txt' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.file.path, 'renamed.txt');
  assert.ok(fs.existsSync(path.join(mine, 'renamed.txt')) && !fs.existsSync(path.join(mine, 'log.txt')));
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'renamed.txt', to: 'sub/renamed.txt' })).status, 200);
  assert.ok(fs.existsSync(path.join(mine, 'sub', 'renamed.txt')));
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: 'sub/inner.md' })).status, 409);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: 'nope/notes.md' })).status, 404);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'gone.md', to: 'x.md' })).status, 404);
  assert.strictEqual((await call('POST', q(1, 'move'), { from: 'sub', to: 'sub2' })).status, 400);
  assert.ok(fs.existsSync(path.join(mine, 'notes.md')));
}));

test('mkdir makes a subfolder; one that exists is a 409; a parent that is missing is a 404', () => withBoard(async ({ call, q, mine }) => {
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'drafts' })).status, 201);
  assert.ok(fs.statSync(path.join(mine, 'drafts')).isDirectory());
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'sub/deeper' })).status, 201);
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'drafts' })).status, 409);
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'a/b/c' })).status, 404);
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: 'notes.md' })).status, 409);
}));

test("each id reaches only its own folder: a file of one card is not there for the other", () => withBoard(async ({ call, q, theirs }) => {
  assert.strictEqual((await call('POST', q(2, 'file'), { path: 'two.md', text: 'x' })).status, 201);
  assert.ok(fs.existsSync(path.join(theirs, 'two.md')));
  assert.strictEqual((await call('DELETE', q(1, 'file'), { path: 'two.md', version: 'v' })).status, 404);
  assert.ok(fs.existsSync(path.join(theirs, 'two.md')));
}));

test('every route of the folder browser is named in the web skill\'s api reference', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'references', 'api.md'), 'utf8');
  for (const route of [
    'GET /api/scratchpad/<id>/files?path=', 'GET /api/scratchpad/<id>/file?path=', 'POST /api/scratchpad/<id>/file',
    'PUT /api/scratchpad/<id>/file', 'DELETE /api/scratchpad/<id>/file', 'POST /api/scratchpad/<id>/move', 'POST /api/scratchpad/<id>/folder',
  ]) assert.ok(api.includes(route), route);
});

test('a page-like name is refused anywhere in its name: dotted names, other cases, and a folder named like a page', () => withBoard(async ({ call, q, mine }) => {
  for (const name of ['x.y.scratchpad.md', 'X.SCRATCHPAD.MD', 'a.b.c.scratchpad.md', 'zzz.scratchpad.md']) {
    assert.strictEqual((await call('POST', q(1, 'file'), { path: name, text: 'x' })).status, 403, name);
    assert.strictEqual((await call('POST', q(1, 'file'), { path: `sub/${name}`, text: 'x' })).status, 403, `sub/${name}`);
    assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: name })).status, 403, `move ${name}`);
    assert.strictEqual((await call('POST', q(1, 'folder'), { path: name })).status, 403, `folder ${name}`);
    assert.ok(!fs.existsSync(path.join(mine, name)), name);
  }
  assert.strictEqual((await call('POST', q(1, 'folder'), { path: '0001.scratchpad.md' })).status, 403);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'sub/.scratchpad.md', text: 'x' })).status, 403);
}));

test('reserved device names are a 400 as a file or a folder, whole or before the first dot, in any case', () => withBoard(async ({ call, q, mine }) => {
  const names = ['con', 'PRN', 'aux', 'Nul', 'com1', 'COM9', 'lpt1', 'LPT9'];
  for (const n of names) {
    for (const p of [`${n}.md`, `${n}.txt`, `${n}.v2.md`, `sub/${n}.md`]) {
      assert.strictEqual((await call('POST', q(1, 'file'), { path: p, text: 'x' })).status, 400, p);
    }
    assert.strictEqual((await call('POST', q(1, 'folder'), { path: n })).status, 400, `folder ${n}`);
    assert.strictEqual((await call('POST', q(1, 'folder'), { path: `${n}.d` })).status, 400, `folder ${n}.d`);
    assert.strictEqual((await call('POST', q(1, 'move'), { from: 'notes.md', to: `${n}.md` })).status, 400, `move ${n}`);
  }
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'com10.md', text: 'x' })).status, 201);
  assert.strictEqual((await call('POST', q(1, 'file'), { path: 'console.md', text: 'x' })).status, 201);
  assert.ok(fs.existsSync(path.join(mine, 'console.md')));
}));

test('a case-only move onto a different existing file is a 409 and replaces nothing', () => withBoard(async ({ call, q, mine }) => {
  fs.writeFileSync(path.join(mine, 'a.md'), 'lower\n');
  fs.writeFileSync(path.join(mine, 'A.md'), 'upper\n');
  const both = fs.readdirSync(mine).filter((n) => n.toLowerCase() === 'a.md').length === 2;
  const r = await call('POST', q(1, 'move'), { from: 'a.md', to: 'A.md' });
  if (both) {
    assert.strictEqual(r.status, 409);
    assert.strictEqual(fs.readFileSync(path.join(mine, 'A.md'), 'utf8'), 'upper\n');
    assert.strictEqual(fs.readFileSync(path.join(mine, 'a.md'), 'utf8'), 'lower\n');
  } else {
    assert.strictEqual(r.status, 200, 'a case-insensitive file system holds one file, so this is a rename of the same file');
  }
}));

test('a case-only rename of one file is allowed', () => withBoard(async ({ call, q, mine }) => {
  const r = await call('POST', q(1, 'move'), { from: 'notes.md', to: 'Notes.md' });
  assert.strictEqual(r.status, 200);
  assert.ok(fs.readdirSync(mine).includes('Notes.md') && !fs.readdirSync(mine).includes('notes.md'));
}));

test('a UNC path never reaches the file system', () => withBoard(async ({ call, q, list, open }) => {
  const asked = [];
  const { realpathSync, statSync, lstatSync, existsSync, readdirSync } = fs;
  const native = realpathSync.native;
  const note = (p) => { if (String(p).includes('evilhost')) asked.push(String(p)); };
  fs.realpathSync.native = (p, ...rest) => { note(p); return native(p, ...rest); };
  fs.statSync = (p, ...rest) => { note(p); return statSync(p, ...rest); };
  fs.lstatSync = (p, ...rest) => { note(p); return lstatSync(p, ...rest); };
  fs.existsSync = (p, ...rest) => { note(p); return existsSync(p, ...rest); };
  fs.readdirSync = (p, ...rest) => { note(p); return readdirSync(p, ...rest); };
  try {
    const bs = String.fromCharCode(92);
    for (const p of ['//evilhost/share/a.md', `${bs}${bs}evilhost${bs}share${bs}a.md`, `${bs}${bs}?${bs}UNC${bs}evilhost${bs}share${bs}a.md`]) {
      refused(await open(1, p), p);
      refused(await list(1, p), p);
      refused(await call('POST', q(1, 'file'), { path: p, text: 'x' }), p);
      refused(await call('DELETE', q(1, 'file'), { path: p, version: 'v' }), p);
      refused(await call('POST', q(1, 'move'), { from: 'notes.md', to: p }), p);
      refused(await call('POST', q(1, 'folder'), { path: p }), p);
    }
  } finally {
    fs.realpathSync.native = native;
    fs.statSync = statSync;
    fs.lstatSync = lstatSync;
    fs.existsSync = existsSync;
    fs.readdirSync = readdirSync;
  }
  assert.deepStrictEqual(asked, []);
}));

test('a save leaves no temp file and never writes through a link planted at <file>.tmp', () => withBoard(async ({ call, q, open, mine, root }) => {
  const outside = path.join(root, 'outside', 'secret.txt');
  const { file } = (await open(1, 'notes.md')).json;
  try { fs.symlinkSync(outside, path.join(mine, 'notes.md.tmp'), 'file'); } catch (_) { /* no right to make a file link here: the leftover check below still holds */ }
  const r = await call('PUT', q(1, 'file'), { path: 'notes.md', text: 'new\n', version: file.version });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'top secret');
  assert.deepStrictEqual(fs.readdirSync(mine).filter((n) => n.endsWith('.tmp') && n !== 'notes.md.tmp'), []);
}));

test('a group id is not a card: the folder browser answers only for a card', () => withBoard(async ({ call, q, list }) => {
  assert.strictEqual((await list('I1')).status, 404);
  assert.strictEqual((await call('POST', q('I1', 'file'), { path: 'a.md', text: 'x' })).status, 404);
  assert.strictEqual((await list(99)).status, 404);
}));
