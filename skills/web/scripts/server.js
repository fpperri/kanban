'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cs = require('./card-store');
const ns = require('./notifications-store');
const cfg = require('./config-store');

const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
// No server-side status whitelist — free-text statuses are legal input end to
// end (the SPA parks unlisted values in the first column). The doing entry
// gate (waiting + blocked) stays pinned to the literal 'doing' inside
// card-store.

// The SPA ships no inline script/style anywhere (every script is a
// separate <script src>, every rule lives in app.css) — so the strictest CSP
// costs nothing. Sent only on the served HTML; the app has no images/fonts to
// widen img-src/font-src for.
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

function originAllowed(req) {
  const host = req.headers.host;
  if (host && !ALLOWED_HOST_RE.test(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) return ALLOWED_ORIGIN_RE.test(origin);
  const referer = req.headers.referer;
  if (referer) {
    try { return ALLOWED_ORIGIN_RE.test(new URL(referer).origin); } catch (_) { return false; }
  }
  return true;
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

function createServer(dir) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      // Reject every request — reads included — carrying a
      // disallowed Origin/Referer/Host before touching any route below.
      if (!originAllowed(req)) {
        return sendJSON(res, 403, { error: 'Forbidden: disallowed Origin/Referer/Host header' });
      }
      // static + board
      if (req.method === 'GET' && p === '/api/board') {
        const active = cs.listActive(dir);
        const archived = cs.listArchived(dir);
        const bad = [...active, ...archived].filter((c) => c.unparseable);
        if (bad.length) console.warn(`[kanban-app] skipping ${bad.length} unparseable card(s): ${bad.map((c) => path.basename(c.file)).join(', ')}`);
        const config = cfg.readConfig(dir); // one read carries the board name, assignees + official lists
        return sendJSON(res, 200, {
          // The BOARD NAME: config.yaml's human-declared `name:` when present,
          // else the parent-folder derivation. Wire name kept as projectName —
          // it is also the localStorage namespace for every per-board view
          // preference, so renaming the field would orphan saved state.
          projectName: config.name || cs.projectName(dir),
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
          archivePackages: cs.listArchivePackages(dir), // archived/<package>/ folder names the archive popup completes against (ADR 0010)
        });
      }
      if (req.method === 'GET' && p === '/') return serveStatic(res, path.join(WEB, 'app.html'));
      if (req.method === 'GET' && (p === '/app.css' || p === '/app.js' || p === '/refresh-policy.js' || p === '/column-state.js' || p === '/column-sort.js' || p === '/search.js' || p === '/waiting-blocked.js' || p === '/dependency-graph.js' || p === '/modal-fullscreen.js' || p === '/assignee-badge.js' || p === '/priority-badge.js' || p === '/card-title.js' || p === '/combobox.js' || p === '/bulk-edit.js' || p === '/notifications.js' || p === '/form-guard.js' || p === '/selection.js' || p === '/calendar-model.js' || p === '/gantt-model.js' || p === '/date-picker.js' || p === '/status-colors.js' || p === '/save-hotkey.js' || p === '/search-hotkey.js' || p === '/assignee-colors.js' || p === '/deep-link.js')) {
        return serveStatic(res, path.join(WEB, path.basename(p)));
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

      // mutations
      if (req.method === 'POST' && p === '/api/cards') {
        const body = await readBody(req);
        try {
          return sendJSON(res, 201, cs.toJSON(cs.createCard(dir, body)));
        } catch (e) {
          // the 422 names WHICH gate refused — waiting carries the
          // unresolved deps, blocked carries the sticker's reason.
          if (e.name === 'WaitingError') return sendJSON(res, 422, { error: e.message, waiting: e.waiting });
          if (e.name === 'BlockedError') return sendJSON(res, 422, { error: e.message, reason: e.reason });
          throw e;
        }
      }
      const m = p.match(/^\/api\/cards\/(\d+)(\/archive|\/restore|\/detail)?$/);
      if (m) {
        const id = Number(m[1]);
        if (!cs.findCardFile(dir, id)) return sendJSON(res, 404, { error: `no card #${id}` });
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
        if (req.method === 'DELETE' && !m[2]) { cs.deleteCard(dir, id); return sendJSON(res, 200, { ok: true }); }
      }

      res.writeHead(404); res.end('not found');
    } catch (err) {
      sendJSON(res, 500, { error: String((err && err.message) || err) });
    }
  });
}

function start(dir, port, attempts = 20) {
  // The dir must exist (checked by the CLI entry below); an empty board is allowed
  // so you can create the first card from the app.
  const srv = createServer(dir);
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempts > 0) { return start(dir, port + 1, attempts - 1); }
    console.error(e.message); process.exit(1);
  });
  const pidPath = path.join(dir, '.kanban-app.pid');
  srv.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(pidPath, `${process.pid}\n${port}\n`);
    const cleanup = () => { try { fs.unlinkSync(pidPath); } catch (_) {} process.exit(0); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    console.log(`Kanban app: http://localhost:${port}  (board: ${dir})`);
  });
  return srv;
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
  const dir = process.argv[2] || resolveDefaultBoardDir();
  if (!fs.existsSync(dir)) { console.error(`Board dir not found: ${dir}`); process.exit(1); }
  const port = Number(process.argv[3]) || 7777;
  start(dir, port);
}

module.exports = { createServer, start, originAllowed, resolveDefaultBoardDir };
