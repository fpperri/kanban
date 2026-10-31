'use strict';
// The Web built with the board inside: one HTML file with the page's files, route.js and the stores it
// runs (over the shims, docs/adr/0025) and the text files of the board folder, so the page opens with no
// server and answers its own saves. node artifact-build.js <boardDir> --out <file.html>
//
// The board's files sit in the page at a made-up root that keeps the shape of the real one (the folder
// that holds the board folder, and whatever else the config's logbook, scratchpad, todos and groups paths
// name outside it), so a relative path in config.yaml resolves as it does at the desk and no path of the
// machine that built the file is in it. Only text files come along: a file with a NUL byte or invalid
// UTF-8 (a picture, a binary) is left out. `buildPage` is for tests and other scripts; the command is
// the same call with a file written.
//
// A Snapshot query, in the Web's search words, picks the cards the page carries (search.js, the module the
// search box runs): by default the live cards, with `archive` the archived ones too. The query is read
// over the whole board, archive included, as the box reads it, so a graph term walks cards it does not
// carry. A card it leaves out carries nothing: its file, and the logbook, scratchpad and todo files made for
// it, stay out of the page. The groups come whole, and a group lists its members by id, so a member left out is
// still counted. A page over 16 MB is refused, with its size and a way to narrow it, before any file is written.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config-store');
const cs = require('./card-store');
const gs = require('./group-store');
const iter = require('./iteration-folders');
const ids = require('../web/ids');
const { parseSearchQuery, filterCards } = require('../web/search');
const { makeRoute } = require('./route');
const { routeSources, configFolders, folderBefore } = require('./route-sources');
const { readApplied, takenBy } = require('./applied-ids');

const WEB_ROOT = path.join(__dirname, '..');
const RUNTIME = ['posix-path', 'crypto-shim', 'buffer-shim', 'memory-fs', 'module-loader', 'memory-route', 'temp-ids', 'artifact-tray', 'page-source'];
const SKIP_NAMES = new Set(['.git', 'node_modules', '.kanban-app.pid']);
const MAX_BYTES = 16 * 1024 * 1024;

const lf = (s) => s.replace(/\r\n?/g, '\n');

const within = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

function commonAncestor(paths) {
  let common = paths[0].split(path.sep);
  for (const p of paths.slice(1)) {
    const parts = p.split(path.sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i += 1;
    common = common.slice(0, i);
  }
  return common.join(path.sep) || path.sep;
}

const TEXT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function textOf(bytes) {
  if (bytes.includes(0)) return null;
  try { return TEXT.decode(bytes); } catch (_) { return null; }
}

function walk(root, visit) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

// { dir, files }: the board folder's place in the page and every text file it holds, by place. `skip(abs)`
// leaves a file out.
function boardFiles(dir, skip = () => false) {
  const roots = [dir];
  for (const abs of configFolders(dir)) if (!roots.some((r) => within(r, abs))) roots.push(abs);
  const ancestor = commonAncestor([path.dirname(dir), ...roots]);
  const kept = roots.filter((r) => within(ancestor, r));
  const top = path.basename(ancestor) ? `/${path.basename(ancestor)}` : '';
  const placeOf = (abs) => `${top}/${path.relative(ancestor, abs).split(path.sep).join('/')}`.replace(/\/$/, '') || '/';
  const files = {};
  for (const root of kept) {
    walk(root, (file) => {
      if (skip(file)) return;
      const text = textOf(fs.readFileSync(file));
      if (text !== null) files[placeOf(file)] = text;
    });
  }
  return { dir: placeOf(dir), files };
}

// JSON that can sit in a script element: no "<" to open a tag or a comment, no line separators.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}

function scriptText(name, text) {
  if (/<\/script/i.test(text)) throw new Error(`${name} contains "</script"; it cannot be inlined`);
  return text.replace(/<!--/g, '<\\x21--');
}

const normal = (p) => path.resolve(p).split(path.sep).join('/');

// The Snapshot query's pick, as sets of card ids and the files of the cards left out. The cards are
// searched as the page holds them (cs.toJSON), live and archived together.
function pickCards(dir, name, { query, archive }) {
  return iter.scoped(() => {
    const config = cfg.readConfig(dir);
    const cards = cs.listActive(dir).concat(cs.listArchived(dir)).filter((c) => !c.unparseable);
    const groups = gs.readGroups(dir);
    const ctx = { board: name, priorities: config.priorities, hierarchy: config.typesOn === false ? [] : config.hierarchy, groups: groups ? groups.list : [] };
    const found = new Set(filterCards(cards.map(cs.toJSON), parseSearchQuery(query, name), ctx).map((c) => c.id));
    const carried = new Set();
    const leftOut = new Set();
    const leftFiles = new Set();
    for (const c of cards) {
      if (found.has(c.id) && (archive || !c.archived)) carried.add(c.id);
      else { leftOut.add(c.id); leftFiles.add(normal(c.file)); }
    }
    return { carried, leftOut, leftFiles };
  });
}

const LOGBOOK_FILE = /^\d{4}\.\d{2}\.\d{2}\.(?:([^.]+)\.)?logbook\.md$/;

// Who a file in a scratchpad, todos or logbook folder was made for: the card id, or null. A scratchpad
// path with `<card>` in it keeps a folder per card (named by its id) and everything under it is that
// card's; any other file is `<id>.scratchpad.md` or `<id>.todo.md`. A logbook day file names its target
// (`2026.10.16.0007.logbook.md`), in the logbook folder or any iteration folder beneath it; a group's
// id never matches a card's, and a day file with no target is the board's.
function ownerOfFile(dir) {
  const config = cfg.readConfig(dir);
  const places = [];
  const logbook = config.paths.logbook ? folderBefore(dir, config.paths.logbook) : null;
  for (const key of ['scratchpad', 'todos']) {
    const value = config.paths[key];
    if (!value) continue;
    const segs = iter.segmentsOf(value);
    const first = segs.findIndex((s) => s === iter.PLACEHOLDER || s === iter.CARD);
    places.push({ root: folderBefore(dir, value), cardAt: first < 0 ? -1 : segs.slice(first).indexOf(iter.CARD) });
  }
  return (abs) => {
    const day = logbook && within(logbook, abs) ? LOGBOOK_FILE.exec(path.basename(abs)) : null;
    if (day) return day[1] ? ids.idKey(day[1]) : null;
    for (const { root, cardAt } of places) {
      if (!within(root, abs)) continue;
      const rel = path.relative(root, abs).split(path.sep);
      if (cardAt >= 0 && rel.length > cardAt + 1) {
        const id = ids.idKey(rel[cardAt].split('.')[0]);
        if (id !== null) return id;
      }
      const m = /^([^.]+)\.(?:scratchpad|todo)\.md$/.exec(rel[rel.length - 1]);
      const id = m ? ids.idKey(m[1]) : null;
      if (id !== null) return id;
    }
    return null;
  };
}

function snapshotLabel(query, archive) {
  const scope = archive ? 'with the archive' : 'live cards only';
  return query ? `${query} · ${scope}` : scope;
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function buildPage({ boardDir, webRoot = WEB_ROOT, now = () => new Date(), query = '', archive = false, maxBytes = MAX_BYTES }) {
  if (!boardDir || !fs.existsSync(boardDir) || !fs.statSync(boardDir).isDirectory()) throw new Error(`Board dir not found: ${boardDir}`);
  const dir = fs.realpathSync(path.resolve(boardDir));
  const name = makeRoute(dir)('GET', '/api/board').body.projectName;
  const asked = String(query || '').trim();
  const board = {
    name,
    id: crypto.createHash('sha256').update(`${name}\0${dir}`).digest('hex').slice(0, 12),
    base: now().toISOString(),
    snapshot: { query: asked, archive: !!archive, label: snapshotLabel(asked, !!archive) },
  };
  const taken = takenBy(readApplied(dir));
  if (Object.keys(taken).length) board.taken = taken;
  const picked = pickCards(dir, name, { query: asked, archive: !!archive });
  const ownerOf = ownerOfFile(dir);
  const placed = boardFiles(dir, (abs) => {
    if (picked.leftFiles.has(normal(abs))) return true;
    const owner = ownerOf(abs);
    return owner !== null && picked.leftOut.has(owner);
  });
  const data = { board, sources: routeSources(webRoot), files: placed.files, dir: placed.dir };

  const web = path.join(webRoot, 'web');
  const read = (file) => lf(fs.readFileSync(file, 'utf8'));
  const runtime = RUNTIME.map((n) => `<script>${scriptText(n, read(path.join(webRoot, 'scripts', `${n}.js`)))}</script>`).join('\n');
  const start = "window.kanbanSourceInUse = window.kanbanPageSource.boot(JSON.parse(document.getElementById('kanban-board').textContent), { storage: (function () { try { return window.localStorage; } catch (e) { return null; } })(), claude: window.claude });";
  const boot = `<script type="application/json" id="kanban-board">${jsonForScript(data)}</script>\n${runtime}\n<script>${start}</script>`;

  const html = read(path.join(web, 'app.html'));
  const comments = [];
  const masked = html.replace(/<!--[\s\S]*?-->/g, (m) => { comments.push(m); return `\u0000${comments.length - 1}\u0000`; });
  let scripts = 0;
  let styled = false;
  let iconed = false;
  const page = masked
    .replace(/<link rel="stylesheet" href="\/app\.css">/, () => {
      const css = read(path.join(web, 'app.css'));
      if (/<\/style/i.test(css)) throw new Error('the stylesheet contains "</style"; it cannot be inlined');
      styled = true;
      return `<style>${css}</style>`;
    })
    .replace(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/, () => {
      iconed = true;
      return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${fs.readFileSync(path.join(web, 'favicon.svg')).toString('base64')}">`;
    })
    .replace(/<script src="\/([\w.-]+\.js)"><\/script>/g, (all, file) => {
      scripts += 1;
      const tag = `<script>${scriptText(file, read(path.join(web, file)))}</script>`;
      return file === 'app.js' ? `${boot}\n${tag}` : tag;
    })
    .replace(/\u0000(\d+)\u0000/g, (all, i) => comments[Number(i)]);
  if (!styled || !iconed || !scripts || !page.includes('id="kanban-board"')) throw new Error('app.html is not the page this build knows: a stylesheet, an icon or the app script is missing');
  if (/<(?:link|script)\b[^>]*\s(?:src|href)="\//.test(page.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('a root-relative reference is left in the page');
  const bytes = Buffer.byteLength(page);
  if (bytes > maxBytes) {
    throw new Error(`The page would be ${megabytes(bytes)}, over the ${megabytes(maxBytes).replace('.0 ', ' ')} limit. Give a narrower query (one group, one iteration, one tag), or leave the archive out.`);
  }
  return { html: page, board, bytes, carried: picked.carried.size, leftOut: picked.leftOut.size };
}

function main(argv) {
  let boardDir = null;
  let out = null;
  let query = '';
  let archive = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--query') { query = argv[++i]; if (query === undefined) return usage('--query takes the search words'); }
    else if (argv[i] === '--archive') archive = true;
    else if (!boardDir) boardDir = argv[i];
    else return usage(`unexpected argument ${argv[i]}`);
  }
  if (!boardDir || !out) return usage();
  try {
    const { html, board, bytes, carried } = buildPage({ boardDir, query, archive });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`${out}: ${(bytes / 1024).toFixed(0)} KB, board "${board.name}", ${board.snapshot.label}, ${carried} card${carried === 1 ? '' : 's'}, base ${board.base}`);
    return 0;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node artifact-build.js <boardDir> --out <file.html> [--query <search words>] [--archive]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildPage, boardFiles };
