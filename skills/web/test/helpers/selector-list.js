'use strict';
const assert = require('node:assert');

// The selectors of the one closest('...') call in `src` that names `anchor`
// as one of its selectors. Membership, not position, is what the view tests care about.
function selectorList(src, anchor) {
  const lists = [...src.matchAll(/closest\('([^']*)'\)/g)]
    .map((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
    .filter((l) => l.length > 1 && l.includes(anchor));
  assert.ok(lists.length > 0, `selector-list anchor not found in any closest('...') call in app.js: ${anchor}`);
  assert.strictEqual(lists.length, 1, `selector-list anchor matches ${lists.length} closest('...') calls in app.js, expected one: ${anchor}`);
  return lists[0];
}

const clickAwayExemptions = (src) => selectorList(src, '#bulk-single');
const pollGuardSelectors = (src) => selectorList(src, '.column-sort-dir');

function assertHasSelectors(list, required, what) {
  const missing = required.filter((s) => !list.includes(s));
  assert.deepStrictEqual(missing, [], `${what} is missing: ${missing.join(', ')}`);
}

module.exports = { selectorList, clickAwayExemptions, pollGuardSelectors, assertHasSelectors };
