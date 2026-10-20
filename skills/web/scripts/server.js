'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cs = require('./card-store');
const ns = require('./notifications-store');
const lb = require('./logbook-store');
const sp = require('./scratchpad-store');
const gs = require('./group-store');
const del = require('./delete-store');
const cfg = require('./config-store');
const settings = require('./settings-store');
const nesting = require('../web/nesting');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');

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

function serveStatic(res, file) {
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const body = fs.readFileSync(file);
  const isHtml = path.extname(file) === '.html';
  // no-store: localhost + tiny files — heuristic caching once served a stale
  // app.html against new scripts and silently broke the form
  const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' };
  if (isHtml) headers['content-security-policy'] = CSP;
  res.writeHead(200, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// A neighbour in a reorder body: a card id as its whole string (`7`, `G3`),
// null when absent, undefined when it is neither.
function readNeighbour(v) {
  if (v === undefined || v === null) return null;
  const key = ids.idKey(typeof v === 'string' ? v.trim() : v);
  return key === null ? undefined : key;
}

function boardName(dir, config) {
  return config.name || cs.projectName(dir);
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
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      // Reject every request — reads included — carrying a
      // disallowed Origin/Referer/Host before touching any route below.
      if (!originAllowed(req, extraOrigins)) {
        return sendJSON(res, 403, { error: 'Forbidden: disallowed Origin/Referer/Host header' });
      }
      // static + board
      if (req.method === 'GET' && p === '/api/board') {
        const active = cs.listActive(dir);
        const archived = cs.listArchived(dir);
        const bad = [...active, ...archived].filter((c) => c.unparseable);
        if (bad.length) console.warn(`[kanban-app] skipping ${bad.length} unparseable card(s): ${bad.map((c) => path.basename(c.file)).join(', ')}`);
        const config = cfg.readConfig(dir); // one read carries the board name, assignees + official lists
        const groups = gs.readGroups(dir);
        if (groups && groups.skipped.length) console.warn(`[kanban-app] skipping ${groups.skipped.length} group file(s): ${groups.skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`);
        return sendJSON(res, 200, {
          // The BOARD NAME: config.yaml's human-declared `name:` when present,
          // else the parent-folder derivation. Wire name kept as projectName —
          // it is also the localStorage namespace for every per-board view
          // preference, so renaming the field would orphan saved state.
          projectName: boardName(dir, config),
          homeUrl,
          // the header copy button copies the board dir's ABSOLUTE
          // path — resolve()d because the CLI defaults dir to a relative
          // '.kanban'/'kanban' (resolveDefaultBoardDir()), and a relative
          // path is useless pasted elsewhere.
          boardDir: path.resolve(dir),
          active: active.filter((c) => !c.unparseable).map(cs.toJSON),
          archived: archived.filter((c) => !c.unparseable).map(cs.toJSON),
          notifications: ns.readNotifications(dir),
          assignees: config.assignees,
          priorities: config.priorities,
          tags: config.tags,
          statuses: config.statuses, // ordered column list; [] = built-in four
          types: config.types, // [{name, color}] card-type vocabulary, plus icon on an entry that sets one; [] = none declared
          hierarchy: config.hierarchy, // type names, top tier first, as written; [] = none declared
          pills: config.pills, // [{label, query}] the board's own pills, in config order; [] = none declared
          archivePackages: cs.listArchivePackages(dir), // archived/<package>/ folder names the archive popup completes against (ADR 0010)
          logbook: config.logbook ? { folder: config.logbook, notes: lb.listNotes(dir) } : null, // the notes of every day file (ADR 0016); null = no logbook: line, nothing shows
          scratchpad: config.scratchpad ? { folder: config.scratchpad, targets: sp.listTargets(dir) } : null, // the folder and the ids that have a page (ADR 0016); the page itself is read when opened; null = no scratchpad: line, nothing shows
          groups, // { folder, list, skipped, folders, prefixes } (ADR 0015); null = no groups: line, nothing shows
          settings: settings.readSettings(dir), // the config the gear's This board pages show (ADR 0017)
          iterations: !!(groups && config.iterations), // iterations: true over a groups: line adds the header's iteration dropdown (ADR 0015)
        });
      }
      if (req.method === 'GET' && p === '/') return serveStatic(res, path.join(webDir, 'app.html'));
      if (req.method === 'GET' && /^\/[\w.-]+$/.test(p) && pageServes(webDir, p.slice(1))) {
        return serveStatic(res, path.join(webDir, p.slice(1)));
      }

      // notifications: the file protocol's app-side mutations
      if (req.method === 'POST' && p === '/api/notifications/mark-read') {
        const body = await readBody(req);
        return sendJSON(res, 200, { notifications: ns.markRead(dir, Array.isArray(body.ids) ? body.ids : undefined) });
      }
      const nm = p.match(/^\/api\/notifications(?:\/(\d+))?$/);
      if (nm && req.method === 'DELETE') {
        return sendJSON(res, 200, {
          notifications: nm[1] ? ns.removeNotification(dir, Number(nm[1])) : ns.clearNotifications(dir),
        });
      }

      // The logbook, the scratchpad, the gear's settings and the groups: a store refusal is a
      // StatusError, which the catch at the end of this handler answers with its own status
      // (400 a bad value, 404 nothing there, 409 a change that clashed, 413 too long).
      if (p === '/api/notes' || p === '/api/notes/assign') {
        const body = await readBody(req);
        if (req.method === 'POST' && p === '/api/notes') return sendJSON(res, 201, { note: lb.addNote(dir, body) });
        if (req.method === 'PATCH' && p === '/api/notes') return sendJSON(res, 200, { note: lb.editNote(dir, body.ref, body) });
        if (req.method === 'DELETE' && p === '/api/notes') return sendJSON(res, 200, lb.deleteNote(dir, body.ref));
        if (req.method === 'POST' && p === '/api/notes/assign') return sendJSON(res, 200, { note: lb.assignNote(dir, body.ref, body.to) });
      }

      // the scratchpad: GET reads a page, PUT writes its body; there is no delete route (only the
      // delete flow takes a page, when asked)
      const pm = p.match(new RegExp(`^/api/scratchpad/(${ids.ID_SOURCE})$`));
      if (pm && (req.method === 'GET' || req.method === 'PUT')) {
        const body = req.method === 'GET' ? {} : await readBody(req);
        return sendJSON(res, 200, { pad: req.method === 'GET' ? sp.readPad(dir, pm[1]) : sp.writePad(dir, pm[1], body.body) });
      }

      // the gear's This board pages: one config.yaml line per request (ADR 0017)
      if (req.method === 'POST' && p === '/api/config') {
        const body = await readBody(req);
        return sendJSON(res, 200, { settings: settings.writeSetting(dir, body) });
      }

      // groups
      const gm = p.match(new RegExp(`^/api/groups(?:/(${ids.ID_SOURCE})(/members)?)?$`));
      if (gm) {
        const body = req.method === 'GET' ? {} : await readBody(req);
        if (!gm[1] && req.method === 'POST') return sendJSON(res, 201, { group: gs.createGroup(dir, body) });
        if (gm[1] && !gm[2] && req.method === 'PATCH') return sendJSON(res, 200, { group: gs.updateGroup(dir, gm[1], body) });
        if (gm[1] && gm[2] && req.method === 'POST') return sendJSON(res, 200, { group: gs.changeMembers(dir, gm[1], body) });
        // the extras to delete with it ride in the body, each only when true (delete-store.js)
        if (gm[1] && !gm[2] && req.method === 'DELETE') return sendJSON(res, 200, { ok: true, ...del.deleteGroup(dir, gm[1], body) });
      }

      // mutations
      if (req.method === 'POST' && p === '/api/cards') {
        const body = await readBody(req);
        try {
          const created = cs.toJSON(cs.createCard(dir, body));
          // Auto-join in the same request: the groups running on the creator's local date
          // with auto_join take the card, and the reply names them for the flash.
          return sendJSON(res, 201, { ...created, joined: gs.joinRunning(dir, created.id, cs.todayLocalDate()) });
        } catch (e) {
          // the 422 names WHICH gate refused — waiting carries the
          // unresolved deps, blocked carries the sticker's reason.
          if (e.name === 'WaitingError') return sendJSON(res, 422, { error: e.message, waiting: e.waiting });
          if (e.name === 'BlockedError') return sendJSON(res, 422, { error: e.message, reason: e.reason });
          throw e;
        }
      }
      const m = p.match(new RegExp(`^/api/cards/(${ids.ID_SOURCE})(/archive|/restore|/detail|/reorder)?$`));
      if (m) {
        const id = ids.idKey(m[1]); // the whole id; null when the digits run past what an id holds
        if (id === null || !cs.findCardFile(dir, id)) return sendJSON(res, 404, { error: `no card #${m[1]}` });
        if (req.method === 'GET' && m[2] === '/detail') {
          const detail = cs.cardDetail(dir, id);
          // file mtime for the popup's "Last modified" fallback when
          // the card predates the `updated` frontmatter field.
          const mtime = fs.statSync(detail.path).mtime.toISOString();
          return sendJSON(res, 200, { ...detail, mtime });
        }
        if (req.method === 'PATCH' && !m[2]) {
          const changes = await readBody(req);
          try {
            return sendJSON(res, 200, cs.toJSON(cs.updateCard(dir, id, changes)));
          } catch (e) {
            if (e.name === 'WaitingError') return sendJSON(res, 422, { error: e.message, waiting: e.waiting });
            if (e.name === 'BlockedError') return sendJSON(res, 422, { error: e.message, reason: e.reason });
            throw e;
          }
        }
        // Optional `package` body field files the card into
        // archived/<package>/ instead of the archived/ root (ADR 0010); a
        // bodyless POST still archives to the root, so every pre-package
        // caller is untouched. A name that isn't one plain path component is
        // the caller's mistake, not a server fault — 400, never 500.
        if (req.method === 'POST' && m[2] === '/archive') {
          const body = await readBody(req);
          try {
            return sendJSON(res, 200, cs.toJSON(cs.archiveCard(dir, id, body.package)));
          } catch (e) {
            if (e.name === 'PackageError') return sendJSON(res, 400, { error: e.message });
            throw e;
          }
        }
        if (req.method === 'POST' && m[2] === '/restore') return sendJSON(res, 200, cs.toJSON(cs.restoreCard(dir, id)));
        // Each card is written on its own, with no transaction across them: a
        // failure part-way leaves the cards before it written.
        if (req.method === 'POST' && m[2] === '/reorder') {
          const body = (await readBody(req)) || {};
          const prev = readNeighbour(body.prev);
          const next = readNeighbour(body.next);
          if (prev === undefined || next === undefined) return sendJSON(res, 400, { error: 'prev and next must be card ids' });
          const config = cfg.readConfig(dir);
          const cards = cs.listActive(dir).concat(cs.listArchived(dir)).filter((c) => !c.unparseable);
          const plan = nesting.reorderPlan(cards, id, { prev, next }, { board: boardName(dir, config), priorities: config.priorities });
          if (plan.error) return sendJSON(res, 400, { error: plan.error });
          const written = nesting.reorderWrites(id, plan).map((w) => cs.toJSON(cs.updateCard(dir, w.id, { rank: w.rank })));
          return sendJSON(res, 200, {
            card: written.find((c) => c.id === id) || cs.toJSON(cards.find((c) => c.id === id)),
            renumbered: written.filter((c) => c.id !== id),
          });
        }
        // Its id always leaves every group's list; the body names the extras to delete with it (delete-store.js).
        if (req.method === 'DELETE' && !m[2]) return sendJSON(res, 200, { ok: true, ...del.deleteCard(dir, id, await readBody(req)) });
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
// anything) keeps its first declaration and ignores the rest.
function warnConfig(dir) {
  for (const { prefix, kept, ignored } of cfg.readConfig(dir).prefixClashes) {
    console.error(`Kanban app: config.yaml declares prefix \`${prefix}\` twice; keeping \`${kept}\`, \`${ignored}\` is ignored.`);
  }
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
  createServer, start, originAllowed, resolveDefaultBoardDir, pageFiles,
  parseAllowedOrigins, extractAllowOriginArgs, resolvePort, warnConfig, parseHomeUrl, extractHomeUrlArg,
};
