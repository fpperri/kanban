'use strict';
// What a script that builds or applies against a board in memory (artifact-build.js, apply-tray.js) reads
// from the disk the same way: the source text route.js runs from, and the folders the board's config names.
// Node only; the page never loads it.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const iter = require('./iteration-folders');

const WEB_ROOT = path.join(__dirname, '..');
const lf = (s) => s.replace(/\r\n?/g, '\n');

// route.js and every file it requires on the way, as the module loader takes them: a path under the web
// skill ('scripts/route.js', 'web/ids.js') to its text.
function routeSources(webRoot = WEB_ROOT, entry = 'scripts/route.js') {
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

// The folder a config path (logbook, scratchpad, todos, groups) names, cut before its first placeholder
// segment, resolved against the board folder.
function folderBefore(dir, value) {
  const kept = [];
  for (const seg of iter.segmentsOf(value)) {
    if (seg === iter.PLACEHOLDER || seg === iter.CARD) break;
    kept.push(seg);
  }
  return path.resolve(dir, kept.join('/') || '.');
}

// The folders beside or outside the board folder that the config's paths name, that exist.
function configFolders(dir) {
  const config = cfg.readConfig(dir);
  const out = [];
  for (const value of [config.paths.logbook, config.paths.scratchpad, config.paths.todos, config.groups]) {
    if (!value) continue;
    const abs = folderBefore(dir, value);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) out.push(abs);
  }
  return out;
}

module.exports = { routeSources, configFolders, folderBefore };
