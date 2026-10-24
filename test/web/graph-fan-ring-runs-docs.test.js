const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web doc and the layout's own header comment say where a parent's children sit on a
// ring of the tier fan: side by side, in one run.

const webDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'web.md'), 'utf8').replace(/\s+/g, ' ');
const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'graph-model.js'), 'utf8').replace(/\s*\r?\n\/\/ ?/g, ' ');

test('the web doc says a parent\'s children on one ring sit side by side, in a run that starts where the first falls', () => {
  assert.match(webDoc, /A parent's children on one ring sit side by side, in the order the Order option shows: the children a parent has on a ring form one unbroken run among its children on that ring or nearer the centre, standing where the first of them falls, so no card of another parent sits on that ring between them/);
  assert.match(webDoc, /a run on a ring further out may sit inside a nearer ring's run, between two of its cards; a parent whose children are all on one ring is laid out in that order alone/);
});

test('the layout\'s header comment says the same rule', () => {
  assert.match(layout, /A parent's children on one ring sit side by side: for each ring, the children it has there form one unbroken run among its children on that ring or nearer the centre/);
  assert.match(layout, /standing where the first of them falls in that order, so no mark of another parent's subtree sits on that ring between them/);
  assert.match(layout, /A run on a ring further out may sit inside a nearer ring's run, between two of its cards/);
});
