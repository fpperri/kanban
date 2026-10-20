const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A mobile layout viewport widens to content that overflows it, which put every full-width phone box
// (the card detail, the Gantt, the Board's status tabs) past the screen. The header's action buttons
// are the widest unwrapped content, so under the phone width line they wrap.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

test('under 760 px the header action buttons wrap and may shrink, so the header cannot widen the layout viewport', () => {
  const blocks = [...css.matchAll(/@media \(max-width: 759\.98px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const rule = blocks.map((b) => b.match(/^\s*\.actions \{([^}]*)\}/m)).find(Boolean);
  assert.ok(rule, 'a phone block styles .actions');
  assert.match(rule[1], /flex-wrap:\s*wrap/);
  assert.match(rule[1], /min-width:\s*0/);
});

test('under 760 px the Gantt and Calendar controls row wraps, so its nav buttons, title and span switcher cannot widen the layout viewport', () => {
  const blocks = [...css.matchAll(/@media \(max-width: 759\.98px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const rule = blocks.map((b) => b.match(/^\s*\.cal-controls \{([^}]*)\}/m)).find(Boolean);
  assert.ok(rule, 'a phone block styles .cal-controls');
  assert.match(rule[1], /flex-wrap:\s*wrap/);
});

test('the wide header keeps its one unwrapped row of actions', () => {
  assert.match(css, /^\.actions \{ display: flex; gap: 8px; \}$/m);
});
