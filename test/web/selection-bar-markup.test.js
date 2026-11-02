const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Where the selection bar is drawn, and the room the page keeps for it. The behaviour of its buttons
// is selection-bar-page.test.js's; whether it clears the view bar and the last card on a real phone
// is the phone scenarios' (phone-steps/selection-bar.js).

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

const PHONE = '@media (max-width: 759.98px) {';
// The text of every block opened by the phone media query.
const phoneBlocks = css.split(PHONE).slice(1).map((chunk) => {
  let depth = 1;
  let end = 0;
  for (; end < chunk.length && depth > 0; end++) {
    if (chunk[end] === '{') depth++;
    else if (chunk[end] === '}') depth--;
  }
  return chunk.slice(0, end);
});
const phone = phoneBlocks.join('\n');
const outsidePhone = phoneBlocks.reduce((rest, block) => rest.replace(block, ''), css);
const ruleOf = (src, selector) => {
  const at = src.indexOf(`\n${selector} {`) >= 0 ? src.indexOf(`\n${selector} {`) : src.indexOf(`\n  ${selector} {`);
  assert.ok(at >= 0, `${selector} has a rule`);
  return src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at));
};

test('the bar stands right after the view bar, hidden to start, with Clear, Archive, Status and More after the count, each keeping the selection', () => {
  assert.match(html, /<\/nav>\s*(<!--[\s\S]*?-->\s*)?<div id="selection-bar" class="selection-bar hidden"/);
  const bar = html.match(/<div id="selection-bar"[\s\S]*?\n<\/div>/)[0];
  assert.match(bar.match(/<div[^>]*>/)[0], /data-keeps-selection/, 'a tap on the bar is no click away');
  const ids = [...bar.matchAll(/<(?:span|button)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['selection-bar-count', 'selection-bar-clear', 'selection-bar-archive', 'selection-bar-status', 'selection-bar-more']);
  const labels = [...bar.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  assert.deepStrictEqual(labels, ['Clear', 'Archive', 'Status', 'More']);
  for (const tag of bar.match(/<button[^>]*>/g)) assert.match(tag, /data-keeps-selection/, tag);
  assert.doesNotMatch(bar, /\sstyle=|\son[a-z]+=/, 'the page runs under a strict CSP');
});

test('Set status… leads the Edit group, and its popup is a bulk popup that keeps the selection and starts hidden', () => {
  const edit = html.match(/<div class="ctx-sub-panel" id="ctx-edit-panel"[\s\S]*?<\/div>/)[0];
  assert.deepStrictEqual([...edit.matchAll(/<button[^>]*\sid="([^"]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]), [
    ['ctx-status', 'Set status…'], ['ctx-assign', 'Assign…'], ['ctx-priority', 'Set priority…'], ['ctx-tags', 'Edit tags…'], ['ctx-schedule', 'Schedule…'],
  ]);
  const popup = html.match(/<div id="bulk-status"[^>]*>/)[0];
  assert.match(popup, /class="modal-backdrop hidden"/);
  assert.match(popup, /data-keeps-selection/);
  assert.match(html, /id="bulk-status-title"/);
  assert.match(html, /id="bulk-status-list"/);
});

test('the bar is not drawn at the desk: it is display none until the phone width query', () => {
  assert.ok(outsidePhone.includes('\n.selection-bar { display: none; }'), 'the bar is display none by default');
  assert.match(ruleOf(phone, '.selection-bar'), /display: flex/);
  assert.ok(!/\.selection-bar\b[^{}]*\{[^}]*display: (flex|block|grid)/.test(outsidePhone), 'no rule outside the phone query draws it');
});

test('on a phone it sits on top of the view bar, under the popups, and wears the theme tokens only', () => {
  const drawn = ruleOf(phone, '.selection-bar');
  assert.match(drawn, /position: fixed/);
  assert.match(drawn, /bottom: var\(--view-bar-h\)/, 'its bottom edge is the view bar\'s top');
  const z = Number(drawn.match(/z-index: (\d+)/)[1]);
  assert.ok(z <= 14, `at most the view bar's layer, under the header, the search panel and every popup (${z})`);
  const modal = Number(css.match(/\.modal-backdrop \{[^}]*z-index: (\d+)/)[1]);
  assert.ok(z < modal, 'a popup covers the bar');
  const bar = ['.selection-bar', '.selection-bar-count', '.selection-bar-btn'].map((sel) => ruleOf(phone, sel)).join('\n');
  assert.doesNotMatch(bar, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'colours come from the tokens');
  assert.match(ruleOf(phone, '.selection-bar-btn'), /min-height: 44px/, 'a thumb\'s height');
});

test('while the bar shows the page gives up its height beside the view bar\'s, in every view, so it covers neither the view bar nor the last card', () => {
  assert.match(phone, /:root \{ --selection-bar-h: 0px; \}/);
  const shows = phone.match(/:root:has\(\.selection-bar:not\(\.hidden\)\) \{ --selection-bar-h: (\d+)px; \}/);
  assert.ok(shows, 'a shown bar sets its height');
  assert.match(ruleOf(phone, '.selection-bar'), new RegExp(`height: var\\(--selection-bar-h\\)`));
  assert.ok(Number(shows[1]) >= 44, 'room for a 44 px button');
  const board = ruleOf(phone, 'main#board');
  assert.match(board, /height: calc\(100dvh - var\(--board-header-h, 64px\) - 48px - 48px - var\(--view-bar-h\) - var\(--selection-bar-h\)\)/);
  assert.match(ruleOf(phone, '.calendar-view, .gantt-view'), /- var\(--view-bar-h\) - var\(--selection-bar-h\)\)/);
  assert.match(ruleOf(phone, '.map-view, .graph-view'), /- var\(--view-bar-h\) - var\(--selection-bar-h\)\)/);
});

test('like the view bar it steps aside while the search field has the keyboard up, and gives its room back', () => {
  const room = phone.indexOf(':root:has(.selection-bar:not(.hidden))');
  const aside = phone.indexOf(':root:has(.search-input:focus) { --selection-bar-h: 0px; }');
  assert.ok(aside > room, 'the focus rule follows the rule it ties with, so it wins');
  assert.match(phone, /:root:has\(\.search-input:focus\) \.selection-bar \{ display: none; \}/);
});
