const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Gantt's label column on a phone: the id and status dot only, a gutter as wide as the widest id
// needs (64 to 96 px), status headings reading in full over the timeline. CSS only, in the one phone
// block beside the Gantt label rules; the label builder and the base rules are what the desktop keeps.

const webDir = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(webDir, 'app.css'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');

const PHONE_QUERY = '@media (max-width: 759.98px) {';

// The body of the first phone media block that follows the base .gantt-label rule.
function ganttPhoneBlock() {
  const from = css.indexOf('\n.gantt-label {');
  assert.ok(from > 0, 'the base .gantt-label rule is in app.css');
  const start = css.indexOf(PHONE_QUERY, from);
  assert.ok(start > 0, 'a phone media block follows the Gantt label rules');
  const open = start + PHONE_QUERY.length;
  const end = css.indexOf('\n}', open);
  return css.slice(open, end);
}

const rule = (block, selector) => {
  for (const m of block.matchAll(/(?:^|\n)\s*([^{\n]+?)\s*\{([^}]*)\}/g)) if (m[1] === selector) return m[2];
  return null;
};

test('the phone block sits beside the Gantt label rules, and names the Gantt only', () => {
  const block = ganttPhoneBlock();
  const gantt = css.indexOf('.gantt-label-id {');
  assert.ok(css.indexOf(PHONE_QUERY, gantt) - gantt < 1500, 'within a few rules of the label rules');
  for (const line of block.split('\n').filter((l) => l.trim())) assert.match(line, /\.gantt-/, line);
});

test('on a phone the label title is hidden', () => {
  assert.match(rule(ganttPhoneBlock(), '.gantt-label-title') || '', /display:\s*none/);
});

test('on a phone the gutter is as wide as its widest id, between 64 and 96 px', () => {
  const g = rule(ganttPhoneBlock(), '.gantt-gutter') || '';
  assert.match(g, /min-width:\s*64px/);
  assert.match(g, /max-width:\s*96px/);
  assert.match(g, /width:\s*max-content/);
  assert.match(g, /flex:\s*0 0 auto/);
});

test('on a phone a status heading runs over the timeline, below popovers', () => {
  const block = ganttPhoneBlock();
  const g = rule(block, '.gantt-gutter') || '';
  assert.match(g, /position:\s*relative/);
  const z = Number((g.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z >= 3 && z < 4, `the gutter rides over the bar rows (z-index 2) and under the popovers: ${z}`);
  const h = rule(block, '.gantt-gutter .gantt-group-row') || '';
  assert.match(h, /overflow:\s*visible/);
  assert.match(h, /white-space:\s*nowrap/);
  assert.match(h, /width:\s*0/);
});

test('the phone block uses theme tokens, no colours of its own', () => {
  assert.doesNotMatch(ganttPhoneBlock(), /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
});

test('the desktop keeps its 200 px gutter and the label rules as they were', () => {
  assert.match(css, /\n\.gantt-gutter \{ flex: 0 0 200px; width: 200px; padding-right: 10px; \}/);
  assert.match(css, /\n\.gantt-label \{ font-size: 0\.78em;[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;/);
  assert.ok(app.includes("<span class=\"gantt-label-id\">#${bar.card.id}</span>${statusBadge(bar.card)}"));
});
