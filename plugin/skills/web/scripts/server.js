'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const { StatusError } = require('./store-common');
const { makeRoute } = require('./route');

const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
// No server-side status whitelist — free-text statuses are legal input end to
// end (the SPA parks unlisted values in the first column). The doing entry
// gate (waiting + blocked) stays pinned to the literal 'doing' inside
// card-store.

// The SPA ships no inline script/style anywhere (every script is a
// separate <script src>, every rule lives in app.css) — so the strictest CSP
// costs nothing. Sent only on the served HTML; the app's one image, the tab
// icon, is served from here too, so img-src needs nothing wider.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Two libraries ride with the plugin, vendored under web/vendor and loaded lazily (never named in
// app.html) by the page script code-blocks.js when a rendered body holds a block that needs one:
// highlight.js colours a typed code block, mermaid draws a ```mermaid block. They are served by exact
// name and nothing else under vendor is (the licence files sit beside them unserved).
const VENDORED = [
  'mermaid/mermaid.min.js',
  'highlight.js/highlight.min.js',
  'highlight.js/github.min.css',
  'highlight.js/github-dark.min.css',
];

// Mermaid writes inline styles, which the page's CSP above refuses, and the page does not loosen it.
// A diagram is drawn instead in a frame of its own (mermaid-frame.html and its script), sandboxed so
// its origin is opaque: it runs only its own script and mermaid, cannot reach the page, the board or
// the network, and is the one place where styles may be inline. Whatever embeds it, the response's own
// `sandbox allow-scripts` holds it there.
const FRAME_FILES = ['mermaid-frame.html', 'mermaid-frame.js'];
const FRAME_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

// The file a request path names among the vendored libraries and the frame's own two, or null: the
// one place the /vendor/ prefix is read, for both the check that lets a sandboxed frame in and the
// route that serves it. A vendored file is version-pinned (the page asks for it by version), so it is
// cached for good; the frame's two files are not versioned and are not.
function frameAssetFile(webDir, p) {
  if (p.startsWith('/vendor/')) {
    const rel = p.slice('/vendor/'.length);
    return VENDORED.includes(rel) ? { file: path.join(webDir, 'vendor', ...rel.split('/')), immutable: true } : null;
  }
  return FRAME_FILES.includes(p.slice(1)) ? { file: path.join(webDir, p.slice(1)), immutable: false } : null;
}

// CSRF + DNS-rebinding guard for every request, reads included — exempting
// GET (mutations only) would leave DNS rebinding's read/exfiltration half
// wide open: a rebound hostile origin is
// same-origin to the browser once resolved to 127.0.0.1, so `fetch('/api/board')`
// from that tab would return the full board with zero write ever attempted.
// The board's real trust boundary is the FILES, not this header check
// (SECURITY.md) — this is defense in depth against a browser tab on some
// other origin silently reading or driving a write here. A header that's
// simply ABSENT is a legitimate local client (curl, direct API calls, an
// agent's tool calls) and is let through; only a PRESENT header naming
// somewhere other than this machine's loopback is refused. Covers localhost
// and 127.0.0.1 on any port — VSCode's Simple Browser and a plain browser tab
// pointed at either both keep working (neither sends an Origin header on a
// same-origin top-level GET, and their Host header always matches the
// address actually typed/loaded).
const ALLOWED_HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const NO_EXTRA_ORIGINS = new Set();

// card #253: an opt-in allowlist of EXACT extra origins (a VS Code Remote
// Tunnel relay, say), additive to the loopback rule above and never a
// substitute for it — the Host check above is untouched. Default empty, so a
// server started without --allow-origin/KANBAN_WEB_ALLOWED_ORIGINS is
// byte-for-byte the guard that existed before this. `origin` is compared
// after normalizing through `new URL(origin).origin` against entries already
// normalized the same way at startup (parseAllowedOrigins below) — exact
// string equality only, so a subdomain or superstring of an allowed origin
// never matches.
function originMatches(origin, extraOrigins) {
  if (ALLOWED_ORIGIN_RE.test(origin)) return true;
  if (!extraOrigins.size) return false;
  try {
    // An opaque-origin URL (file:, data:, about:, a sandboxed blob:) has the
    // literal string "null" as its origin, and so does every other one — so
    // "null" must never be a usable key here or one entry would admit them
    // all. parseAllowedOrigins refuses to build such an entry; this is the
    // matching-side half of the same rule, for a Set built any other way.
    const normalized = new URL(origin).origin;
    return normalized !== 'null' && extraOrigins.has(normalized);
  } catch (_) { return false; }
}

// A sandboxed frame has an opaque origin, which a browser may send as the string "null". It may read
// the frame's own files, which are public and carry nothing of the board, and only those: the host
// must still be this machine, and every other path keeps the rule above.
function sandboxedAssetAllowed(req, pathname, webDir) {
  const host = req.headers.host;
  return req.method === 'GET' && req.headers.origin === 'null' && frameAssetFile(webDir, pathname) !== null && (!host || ALLOWED_HOST_RE.test(host));
}

function originAllowed(req, extraOrigins = NO_EXTRA_ORIGINS) {
  const host = req.headers.host;
  if (host && !ALLOWED_HOST_RE.test(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) return originMatches(origin, extraOrigins);
  const referer = req.headers.referer;
  if (referer) {
    try { return originMatches(new URL(referer).origin, extraOrigins); } catch (_) { return false; }
  }
  return true;
}

// Normalizes CLI `--allow-origin` values (repeated) and the
// `KANBAN_WEB_ALLOWED_ORIGINS` env var (comma-separated) into one Set of
// origins, merging both sources. Each entry is run through `new URL(entry).origin`
// once here at startup — the same normalization applied to the incoming
// request's Origin/Referer in originMatches above, so the comparison is
// exact-string. An entry that doesn't parse as a URL is a startup
// configuration mistake, not a security-relevant one to paper over: silently
// dropping it would leave the allowlist quietly narrower than what the
// operator configured, and the failure mode (a tunnel origin that never gets
// through) would only surface later as confusing 403s. Failing loudly here,
// before the server ever binds, is the honest behavior.
function parseAllowedOrigins(cliOrigins, envValue) {
  const raw = [...(cliOrigins || [])];
  if (envValue) raw.push(...String(envValue).split(','));
  const origins = new Set();
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = new URL(trimmed); } catch (_) {
      throw new Error(`invalid allowed origin ${JSON.stringify(trimmed)} (--allow-origin / KANBAN_WEB_ALLOWED_ORIGINS)`);
    }
    // Only http(s) has an origin worth comparing. A file:/data:/about: entry
    // normalizes to the string "null" — which is the origin of EVERY
    // opaque-origin URL, so one such entry would quietly admit any file://
    // page or data: document the browser hands us, far wider than the
    // operator asked for. Refuse it at the door.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`invalid allowed origin ${JSON.stringify(trimmed)}: only http:// and https:// origins can be allowlisted (--allow-origin / KANBAN_WEB_ALLOWED_ORIGINS)`);
    }
    origins.add(parsed.origin);
  }
  return origins;
}

// Pulls repeated `--allow-origin <origin>` flags out of a CLI argv slice
// (already past `node script.js`), returning their values plus every other
// argument in original relative order. This keeps the existing positional
// board-dir/port arguments (`process.argv[2]`/`[3]`) working unchanged
// whether --allow-origin is absent, or present before/after/between them.
function extractAllowOriginArgs(argv) {
  const origins = [];
  const rest = [];
  const EQ = '--allow-origin=';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-origin') {
      i += 1;
      if (i >= argv.length) throw new Error('--allow-origin requires a value');
      origins.push(argv[i]);
    } else if (arg.startsWith(EQ)) {
      // The `=` spelling has to be understood, not fall through to `rest`:
      // `server.js <dir> --allow-origin=https://x` would otherwise start a
      // server with an EMPTY allowlist and no complaint, leaving the operator
      // to debug 403s against a guard they believe they widened.
      const value = arg.slice(EQ.length);
      if (!value) throw new Error('--allow-origin requires a value');
      origins.push(value);
    } else {
      rest.push(arg);
    }
  }
  return { origins, rest };
}

// The address the header's home icon leads to. Same strictness as the origin
// allowlist: http(s) only, so a javascript: or data: value can never become an href.
function parseHomeUrl(value) {
  const trimmed = String(value == null ? '' : value).trim();
  let parsed;
  try { parsed = new URL(trimmed); } catch (_) {
    throw new Error(`invalid home url ${JSON.stringify(trimmed)} (--home-url)`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`invalid home url ${JSON.stringify(trimmed)}: only http:// and https:// addresses are allowed (--home-url)`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`invalid home url ${JSON.stringify(trimmed)}: an address carrying credentials is not allowed (--home-url)`);
  }
  return parsed.href;
}

function extractHomeUrlArg(argv) {
  let homeUrl;
  const rest = [];
  const EQ = '--home-url=';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--home-url') {
      i += 1;
      if (i >= argv.length || !argv[i]) throw new Error('--home-url requires a value');
      homeUrl = argv[i];
    } else if (arg.startsWith(EQ)) {
      if (!arg.slice(EQ.length)) throw new Error('--home-url requires a value');
      homeUrl = arg.slice(EQ.length);
    } else {
      rest.push(arg);
    }
  }
  return { homeUrl, rest };
}

function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
}

function serveStatic(res, file, { csp = CSP, immutable = false } = {}) {
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const body = fs.readFileSync(file);
  const isHtml = path.extname(file) === '.html';
  // no-store: localhost + tiny files — heuristic caching once served a stale
  // app.html against new scripts and silently broke the form
  const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' };
  if (isHtml) headers['content-security-policy'] = csp;
  res.writeHead(200, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8'); // one decoder for the whole body, so a character split across two chunks arrives whole
    req.on('data', (c) => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// The page names every file it loads (the scripts, the stylesheet, the tab
// icon) and the server serves those files and no others: one list, so adding a
// module takes its tag in app.html and nothing here. Only plain top-level
// names count (no subfolder, no other origin), and a tag inside a comment is
// not a tag.
function pageFiles(html) {
  const live = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const names = [];
  for (const m of live.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="\/([\w.-]+)"/g)) {
    if (/^\.+$/.test(m[1]) || names.includes(m[1])) continue;
    names.push(m[1]);
  }
  return names;
}

// Read per request, like the files themselves (no-store): a page edited under
// a running server is served as it now reads.
function pageServes(webDir, name) {
  try { return pageFiles(fs.readFileSync(path.join(webDir, 'app.html'), 'utf8')).includes(name); } catch (_) { return false; }
}

function createServer(dir, extraOrigins = NO_EXTRA_ORIGINS, homeUrl = null, webDir = WEB) {
  const route = makeRoute(dir, { homeUrl });
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      // Reject every request — reads included — carrying a
      // disallowed Origin/Referer/Host before touching any route below.
      if (!originAllowed(req, extraOrigins) && !sandboxedAssetAllowed(req, p, webDir)) {
        return sendJSON(res, 403, { error: 'Forbidden: disallowed Origin/Referer/Host header' });
      }
      // every /api request, reads included, is answered by the route module
      if (p.startsWith('/api/')) {
        const body = req.method === 'GET' ? {} : await readBody(req);
        const answer = route(req.method, req.url, body);
        if (answer === null) { res.writeHead(404); res.end('not found'); return; }
        if (Buffer.isBuffer(answer.body)) {
          res.writeHead(answer.status, { 'content-type': answer.type, 'content-length': answer.body.length, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
          res.end(answer.body);
          return;
        }
        return sendJSON(res, answer.status, answer.body);
      }
      if (req.method === 'GET' && p === '/') return serveStatic(res, path.join(webDir, 'app.html'));
      const frameAsset = req.method === 'GET' ? frameAssetFile(webDir, p) : null;
      if (frameAsset) return serveStatic(res, frameAsset.file, { csp: FRAME_CSP, immutable: frameAsset.immutable });
      if (req.method === 'GET' && /^\/[\w.-]+$/.test(p) && pageServes(webDir, p.slice(1))) {
        return serveStatic(res, path.join(webDir, p.slice(1)));
      }

      res.writeHead(404); res.end('not found');
    } catch (err) {
      if (err instanceof StatusError) return sendJSON(res, err.status, { error: err.message });
      sendJSON(res, 500, { error: String((err && err.message) || err) });
    }
  });
}

// Options (4th arg) rather than a 4th positional: cards #253 and #254 each
// wanted that slot, and a positional would let a caller pass one card's value
// into the other card's parameter with nothing to catch it.
//   extraOrigins (#253): the opt-in exact-match allowlist to hand createServer.
//   pinned (#254): the port came from config.yaml's `port:` key, not the CLI arg
//   or the 7777 default. A pin exists so the board's address never drifts -- a
//   busy PINNED port is a startup error, never a silent increment (auto-increment
//   survives only for the unpinned default case).
function start(dir, port, attempts = 20, opts = {}) {
  const { pinned = false, extraOrigins = NO_EXTRA_ORIGINS, homeUrl = null } = opts;
  // The dir must exist (checked by the CLI entry below); an empty board is allowed
  // so you can create the first card from the app.
  const srv = createServer(dir, extraOrigins, homeUrl);
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      if (pinned) {
        console.error(`Kanban app: port ${port} is pinned by config.yaml's \`port:\` key but is already in use. Free the port, or edit/remove \`port:\` in config.yaml, then retry.`);
        process.exit(1);
        return; // belt-and-braces: never fall through to auto-increment below,
                // even if something stubs process.exit (e.g. tests)
      }
      if (attempts > 0) return start(dir, port + 1, attempts - 1, { extraOrigins, homeUrl });
    }
    console.error(e.message); process.exit(1);
  });
  const pidPath = path.join(dir, '.kanban-app.pid');
  srv.listen(port, '127.0.0.1', () => {
    // Report the port the socket ACTUALLY bound, never the one we asked
    // for. They differ whenever `port` is 0 (an embedder letting the OS
    // pick), and this pidfile and log line are the only record of where the
    // board is reachable — neither may ever name a port nothing bound.
    const bound = srv.address().port;
    fs.writeFileSync(pidPath, `${process.pid}\n${bound}\n`);
    const cleanup = () => { try { fs.unlinkSync(pidPath); } catch (_) {} process.exit(0); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    console.log(`Kanban app: http://localhost:${bound}  (board: ${dir})${pinned ? '  [pinned by config.yaml]' : ''}`);
    // card #253: so a later debrief can see what a running server accepts,
    // printed unconditionally (including the empty case) rather than only
    // when non-default.
    console.log(`Kanban app: extra allowed origins: ${extraOrigins.size ? [...extraOrigins].join(', ') : 'none'}`);
  });
  return srv;
}

const DEFAULT_PORT = 7777;
// A bindable TCP port. The upper bound is not decoration: `srv.listen()`
// throws ERR_SOCKET_BAD_PORT — an uncaught stack, not a message — for
// anything outside 1-65535, so both port inputs are screened here.
const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

// Precedence for the port to bind: CLI argument > config.yaml's `port:` >
// default 7777 (which auto-increments past a busy port — see `start`). An
// `arg` that isn't a bindable port (absent, or an invalid/out-of-range
// string) is treated as "no CLI argument given", falling through to the
// pin/default — the old `Number(argv[3]) || 7777` let `0` and `NaN` fall
// through the same way. Returns `{ port, pinned }` — `pinned` is what tells
// `start` to refuse rather than increment on EADDRINUSE.
//
// Both fall-throughs SAY SO on stderr. Landing on 7777-with-auto-increment
// because a `port:` line or a CLI argument was unusable is precisely the
// drifting bookmark this key exists to prevent, so it never happens
// quietly; only the honest "no pin, no argument" case is silent.
function resolvePort(dir, arg) {
  const given = arg !== undefined && arg !== null && String(arg).trim() !== '';
  const cliPort = Number(arg);
  if (given && isPort(cliPort)) return { port: cliPort, pinned: false };
  if (given) console.error(`Kanban app: ignoring the port argument \`${arg}\` — not a port number (1-65535). Falling back to config.yaml's \`port:\` or ${DEFAULT_PORT}.`);
  const config = cfg.readConfig(dir);
  if (config.port) return { port: config.port, pinned: true };
  if (config.portInvalid !== null && config.portInvalid !== undefined) {
    console.error(`Kanban app: ignoring config.yaml's \`port: ${config.portInvalid}\` — not a port number (1-65535). Starting at ${DEFAULT_PORT} with auto-increment instead, so this board's URL can drift; fix the line to pin it.`);
  }
  return { port: DEFAULT_PORT, pinned: false };
}

// What the config says that the server cannot use as written, said once at startup on stderr and
// never fatal: a prefix declared for a card type and again for a groups folder (or twice for
// anything) keeps its first declaration and ignores the rest. The same for the `vars:` block and the
// words in the logbook, scratchpad and todos paths (docs/adr/0023): each is named once, and the server
// starts all the same.
function warnConfig(dir) {
  const config = cfg.readConfig(dir);
  for (const { prefix, kept, ignored } of config.prefixClashes) {
    console.error(`Kanban app: config.yaml declares prefix \`${prefix}\` twice; keeping \`${kept}\`, \`${ignored}\` is ignored.`);
  }
  for (const notice of config.pathNotices) console.error(`Kanban app: ${notice}`);
}

// Board-directory discovery for a missing CLI arg: `.kanban/` is the
// preferred convention, `kanban/` a supported legacy fallback — checked
// relative to `baseDir` (default: cwd). Neither present: fall back to the
// preferred name so the existsSync check below reports it, not the legacy one.
function resolveDefaultBoardDir(baseDir) {
  baseDir = baseDir || process.cwd();
  if (fs.existsSync(path.join(baseDir, '.kanban'))) return '.kanban';
  if (fs.existsSync(path.join(baseDir, 'kanban'))) return 'kanban';
  return '.kanban';
}

if (require.main === module) {
  let cliOrigins, rest, rawHomeUrl, homeUrl = null;
  try {
    ({ origins: cliOrigins, rest } = extractAllowOriginArgs(process.argv.slice(2)));
    ({ homeUrl: rawHomeUrl, rest } = extractHomeUrlArg(rest));
    if (rawHomeUrl !== undefined) homeUrl = parseHomeUrl(rawHomeUrl);
  } catch (e) { console.error(e.message); process.exit(1); }
  const dir = rest[0] || resolveDefaultBoardDir();
  if (!fs.existsSync(dir)) { console.error(`Board dir not found: ${dir}`); process.exit(1); }
  const { port, pinned } = resolvePort(dir, rest[1]);
  warnConfig(dir);
  let extraOrigins;
  try {
    extraOrigins = parseAllowedOrigins(cliOrigins, process.env.KANBAN_WEB_ALLOWED_ORIGINS);
  } catch (e) { console.error(e.message); process.exit(1); }
  start(dir, port, 20, { pinned, extraOrigins, homeUrl });
}

module.exports = {
  createServer, start, originAllowed, resolveDefaultBoardDir, pageFiles, VENDORED, FRAME_FILES, frameAssetFile,
  parseAllowedOrigins, extractAllowOriginArgs, resolvePort, warnConfig, parseHomeUrl, extractHomeUrlArg,
};
