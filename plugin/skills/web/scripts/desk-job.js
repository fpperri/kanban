'use strict';
// Settings and notifications are a desk job: a page and the apply of its tray both refuse them. deskJob({ method,
// path, body }) answers the reason a change is refused, or null. A path is read the way the route reads it (a URL
// against a dummy base), so `/api/./config`, `/api/x/../config`, `/api/config#x` and a path with a tab in it
// are the config route too; a path that does not parse is refused. Same dual-environment pattern as ids.js:
// required by node --test and the apply, and loaded as a plain <script> (one global, window.kanbanDeskJob).

const deskJobModule = (() => {
  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const UNREADABLE = 'That path cannot be read as a route, so it is refused.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;

  function pathnameOf(path) {
    try { return new URL(String(path), 'http://localhost').pathname; } catch (_) { return null; }
  }

  function deskJob(change) {
    const pathname = pathnameOf(change.path);
    if (pathname === null) return UNREADABLE;
    return DESK_JOB_PATH.test(pathname) ? DESK_JOB : null;
  }

  return { deskJob, pathnameOf, DESK_JOB };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = deskJobModule;
} else {
  window.kanbanDeskJob = deskJobModule;
}
