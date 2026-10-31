const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'web');

// The source text of route.js and every file it requires on the way, as the module loader takes it:
// a path under the web skill ('scripts/route.js', 'web/ids.js') to the text. The walk follows each
// relative require('...'); a built-in is the loader's to shim.
function routeSources(entry = 'scripts/route.js') {
  const sources = {};
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (Object.prototype.hasOwnProperty.call(sources, file)) continue;
    const text = fs.readFileSync(path.join(PLUGIN, file), 'utf8');
    sources[file] = text;
    for (const m of text.matchAll(/require\('(\.[^']*)'\)/g)) {
      const base = path.posix.join(path.posix.dirname(file), m[1]);
      pending.push(base.endsWith('.js') ? base : `${base}.js`);
    }
  }
  return sources;
}

module.exports = { routeSources, PLUGIN };
