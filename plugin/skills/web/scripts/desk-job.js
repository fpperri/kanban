'use strict';
// Settings and notifications are a desk job: a page and the apply of its tray both refuse them. deskJob({ method,
// path, body }) answers the reason a change is refused, or null. A path is read the way the route reads it (a URL
// against a dummy base, ids.routePath), so `/api/./config`, `/api/x/../config`, `/api/config#x` and a path with a tab in it
// are the config route too; a path that does not parse is refused. The apply takes only a canonical path (canonical()). Same dual-environment pattern as ids.js:
// required by node --test and the apply, and loaded as a plain <script> (one global, window.kanbanDeskJob).

const deskJobModule = (() => {
  const ids = typeof module !== 'undefined' && module.exports ? require('../web/ids') : window.kanbanIds;
  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const UNREADABLE = 'That path cannot be read as a route, so it is refused.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;

  // The path a change names, once it is in the form the page records: it starts with /api/ and reading it as the
  // route does changes nothing. null for any other spelling (an alias, a full URL, a scheme, a leading space).
  function canonical(path) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) return null;
    return ids.routePath(path) === path ? path : null;
  }

  // Every reading of the path up to the one reading it again changes nothing: a desk-job route at any of them
  // refuses the change, and a path that never settles is refused as unreadable.
  function deskJob(change) {
    let at = change.path;
    for (let i = 0; i < 6; i++) {
      const next = ids.routePath(at);
      if (next === null) return UNREADABLE;
      if (DESK_JOB_PATH.test(next.split('?')[0])) return DESK_JOB;
      if (next === at) return null;
      at = next;
    }
    return UNREADABLE;
  }

  return { deskJob, canonical, DESK_JOB, UNREADABLE };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = deskJobModule;
} else {
  window.kanbanDeskJob = deskJobModule;
}
