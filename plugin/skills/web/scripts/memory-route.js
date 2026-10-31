'use strict';
// route(method, path, body) over a board held in memory: makeMemoryRoute(sources, { files, dir, homeUrl })
// runs route.js and the stores it requires, unchanged, in the module loader, over the in-memory file
// system seeded with `files` (absolute path to text or bytes), with the POSIX path and crypto shims.
// `sources` maps a path to a source text, as module-loader.js takes it, and holds route.js at
// 'scripts/route.js'; `dir` is the board folder in `files`. It answers { route, fs }, the fs being the
// in-memory one, for whoever reads the files the saves left. Same dual-environment pattern as ids.js:
// required by node --test, and loaded as a plain <script> (one global, window.kanbanMemoryRoute).

const memoryRouteModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryFs } = node ? require('./memory-fs') : window.kanbanMemoryFs;
  const { makeLoader } = node ? require('./module-loader') : window.kanbanModuleLoader;
  const posixPath = node ? require('./posix-path') : window.kanbanPosixPath;
  const cryptoShim = node ? require('./crypto-shim') : window.kanbanCryptoShim;

  // `now` is the clock the file times read; `Buffer` (null for none) overrides the page's own.
  function makeMemoryRoute(sources, { files = {}, dir, homeUrl = null, now, ...rest } = {}) {
    const bufferGiven = 'Buffer' in rest;
    const fs = makeMemoryFs(files, { ...(now ? { now } : {}), ...(bufferGiven ? { Buffer: rest.Buffer } : {}) });
    const loader = makeLoader({ sources, builtins: { fs, path: posixPath, crypto: cryptoShim }, globals: bufferGiven ? { Buffer: rest.Buffer } : {} });
    const { makeRoute } = loader.load('scripts/route.js');
    return { route: makeRoute(dir, { homeUrl }), fs };
  }

  return { makeMemoryRoute };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = memoryRouteModule;
} else {
  window.kanbanMemoryRoute = memoryRouteModule;
}
