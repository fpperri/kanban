const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VIEW_ICON_NAMES, viewIconSvg } = require('../../plugin/skills/web/web/view-icons');

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const NAMES = ['board', 'calendar', 'gantt', 'map', 'graph', 'refresh', 'new'];

test('the module holds the Board, Calendar, Gantt, Map, Graph, Refresh and New card shapes', () => {
  assert.deepStrictEqual([...VIEW_ICON_NAMES], NAMES);
  assert.ok(Object.isFrozen(VIEW_ICON_NAMES));
});

test('each shape is a line icon in a 24 px box, stroked with the current colour and never filled', () => {
  for (const name of NAMES) {
    const svg = viewIconSvg(name);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"/, name);
    assert.match(svg, /fill="none"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    assert.match(svg, /stroke-width="2"/, name);
    assert.match(svg, /aria-hidden="true"/, name);
    assert.doesNotMatch(svg, /style=|#[0-9a-f]{3,6}\b/i, `${name}: colours come from the theme only`);
    assert.match(svg, /<(path|rect|circle|line)\b/, name);
  }
});

test('a name the table does not hold answers nothing', () => {
  for (const bad of ['', 'nope', undefined, null, 7, {}, 'Board']) assert.strictEqual(viewIconSvg(bad), '', String(bad));
});

test('the page loads the module from one script tag right after type-icons.js, with the dual-environment tail', () => {
  const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.filter((s) => s === 'view-icons.js').length, 1);
  assert.strictEqual(scripts.indexOf('view-icons.js'), scripts.indexOf('type-icons.js') + 1);
  assert.ok(scripts.indexOf('view-icons.js') < scripts.indexOf('app.js'));
  const src = fs.readFileSync(path.join(WEB, 'view-icons.js'), 'utf8');
  assert.match(src, /module\.exports/);
  assert.match(src, /window\.viewIconSvg = viewIconSvg/);
});
