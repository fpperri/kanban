const path = require('node:path');
const sources = require('../../../plugin/skills/web/scripts/route-sources');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'web');

// The source text of route.js and every file it requires on the way, as the module loader takes it:
// a path under the web skill ('scripts/route.js', 'web/ids.js') to the text.
const routeSources = (entry = 'scripts/route.js') => sources.routeSources(PLUGIN, entry);

module.exports = { routeSources, PLUGIN };
