'use strict';
// The data a built page embeds, as boot() takes it: the JSON block, with `sources` the functions the page's
// module script registers (the build writes each route module as a function, so the page compiles no text).
// Not a test file (the suite runs *.test.js only).
const REGISTRY = /<script>(window\.kanbanModuleFns = [\s\S]*?)<\/script>/;

function pageData(html) {
  const data = JSON.parse(html.match(/<script type="application\/json" id="kanban-board">([\s\S]*?)<\/script>/)[1]);
  const registry = html.match(REGISTRY);
  if (!registry) throw new Error('the page has no module script');
  const window = {};
  new Function('window', registry[1])(window);
  return { ...data, sources: window.kanbanModuleFns };
}

module.exports = { pageData, REGISTRY };
