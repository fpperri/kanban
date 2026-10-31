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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config-store');
const iter = require('./iteration-folders');
const { makeRoute } = require('./route');

const WEB_ROOT = path.join(__dirname, '..');
const RUNTIME = ['posix-path', 'crypto-shim', 'buffer-shim', 'memory-fs', 'module-loader', 'memory-route', 'artifact-tray', 'page-source'];
const SKIP_NAMES = new Set(['.git', 'node_modules', '.kanban-app.pid']);

const lf = (s) => s.replace(/\r\n?/g, '\n');

// route.js and every file it requires on the way, as the module loader takes them: a path under the web
// skill ('scripts/route.js', 'web/ids.js') to its text.
function routeSources(webRoot, entry = 'scripts/route.js') {
  const sources = {};
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (Object.prototype.hasOwnProperty.call(sources, file)) continue;
    const text = lf(fs.readFileSync(path.join(webRoot, file), 'utf8'));
    sources[file] = text;
    for (const m of text.matchAll(/require\('(\.[^']*)'\)/g)) {
      const base = path.posix.join(path.posix.dirname(file), m[1]);
      pending.push(base.endsWith('.js') ? base : `${base}.js`);
    }
  }
  return sources;
}

// The folders outside (or beside) the board folder that the config's paths name, cut before the first
// placeholder segment, that exist.
function configFolders(dir) {
  const config = cfg.readConfig(dir);
  const out = [];
  for (const value of [config.paths.logbook, config.paths.scratchpad, config.paths.todos, config.groups]) {
    if (!value) continue;
    const kept = [];
    for (const seg of iter.segmentsOf(value)) {
      if (seg === iter.PLACEHOLDER || seg === iter.CARD) break;
      kept.push(seg);
    }
    const abs = path.resolve(dir, kept.join('/') || '.');
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) out.push(abs);
  }
  return out;
}

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

// { dir, files }: the board folder's place in the page and every text file it holds, by place.
function boardFiles(dir) {
  const roots = [dir];
  for (const abs of configFolders(dir)) if (!roots.some((r) => within(r, abs))) roots.push(abs);
  const ancestor = commonAncestor([path.dirname(dir), ...roots]);
  const kept = roots.filter((r) => within(ancestor, r));
  const top = path.basename(ancestor) ? `/${path.basename(ancestor)}` : '';
  const placeOf = (abs) => `${top}/${path.relative(ancestor, abs).split(path.sep).join('/')}`.replace(/\/$/, '') || '/';
  const files = {};
  for (const root of kept) {
    walk(root, (file) => {
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

function buildPage({ boardDir, webRoot = WEB_ROOT, now = () => new Date() }) {
  if (!boardDir || !fs.existsSync(boardDir) || !fs.statSync(boardDir).isDirectory()) throw new Error(`Board dir not found: ${boardDir}`);
  const dir = fs.realpathSync(path.resolve(boardDir));
  const name = makeRoute(dir)('GET', '/api/board').body.projectName;
  const board = {
    name,
    id: crypto.createHash('sha256').update(`${name}\0${dir}`).digest('hex').slice(0, 12),
    base: now().toISOString(),
  };
  const placed = boardFiles(dir);
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
  return { html: page, board, bytes: Buffer.byteLength(page) };
}

function main(argv) {
  let boardDir = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (!boardDir) boardDir = argv[i];
    else return usage(`unexpected argument ${argv[i]}`);
  }
  if (!boardDir || !out) return usage();
  try {
    const { html, board, bytes } = buildPage({ boardDir });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`${out}: ${(bytes / 1024).toFixed(0)} KB, board "${board.name}", base ${board.base}`);
    return 0;
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node artifact-build.js <boardDir> --out <file.html>');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildPage, routeSources, boardFiles };
