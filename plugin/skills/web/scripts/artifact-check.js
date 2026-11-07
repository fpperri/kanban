'use strict';
// Is the published Board artifact's page behind? Reads the stamp the last refresh recorded in the board folder
// and local git, builds nothing and fetches nothing. node artifact-check.js <boardDir> [--json] [--plugin <dir>]
//
// Exit code is the verdict: 0 current (skip the build), 10 only the board moved, 11 the plugin moved (new page
// code), 12 cannot tell (build as usual), 2 a bad call.
//
// --record writes the stamp for what the tree is now (what a build just used): run it after a publish lands,
// and commit the file with the board.
const path = require('path');
const stamp = require('./build-stamp');

function main(argv) {
  let boardDir = null;
  let pluginDir = path.join(__dirname, '..', '..', '..');
  let json = false;
  let record = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--record') record = true;
    else if (argv[i] === '--plugin') { pluginDir = argv[++i]; if (!pluginDir) return usage('--plugin takes a folder'); }
    else if (!boardDir) boardDir = argv[i];
    else return usage(`unexpected argument ${argv[i]}`);
  }
  if (!boardDir) return usage();
  boardDir = path.resolve(boardDir);
  pluginDir = path.resolve(pluginDir);
  if (record) {
    const now = stamp.stampNow({ boardDir, pluginDir });
    const file = stamp.record(boardDir, now);
    console.log(`${file}: plugin ${now.plugin || 'none'}, board ${now.board || 'none'}`);
    return 0;
  }
  const r = stamp.check({ boardDir, pluginDir });
  console.log(json ? JSON.stringify(r) : stamp.describe(r));
  return stamp.EXIT[r.verdict];
}

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node artifact-check.js <boardDir> [--json] [--plugin <plugin dir>] [--record]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };
