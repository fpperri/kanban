const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function loadFrontmatterValueHtml(types) {
  const src = [
    fn('formatLocalDateTime'),
    appSrc.match(/const LOCAL_DATETIME_VALUE_RE = [^\n]*\n/)[0],
    fn('formatFrontmatterValue'),
    fn('frontmatterValueHtml'),
  ].join('\n');
  const sandbox = {
    escapeHtml: require('../web/assignee-badge').escapeHtml,
    ...require('../web/waiting-blocked'),
    statusColorClass: require('../web/status-colors').statusColorClass,
    assigneeBadge: require('../web/assignee-badge').assigneeBadge,
    typeBadge: require('../web/type-badge').typeBadge,
    state: { projectName: 'board', assignees: [], types },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.frontmatterValueHtml;
}

test('the card detail shows a type: line as a chip in the type\'s configured color', () => {
  const fm = loadFrontmatterValueHtml([{ name: 'objective', color: '#a371f7' }]);
  assert.strictEqual(fm('type', 'objective'),
    '<span class="type-chip" title="objective" data-type-color="#a371f7">objective</span>');
});

test('in the detail a type missing from the list is a neutral chip, and a quoted value is unquoted', () => {
  const fm = loadFrontmatterValueHtml([{ name: 'objective', color: '#a371f7' }]);
  assert.strictEqual(fm('type', '"spike"'), '<span class="type-chip" title="spike">spike</span>');
  assert.strictEqual(fm('type', 'objective').includes('data-type-color'), true);
});

test('in the detail a hostile type stays escaped', () => {
  const fm = loadFrontmatterValueHtml([]);
  assert.ok(!fm('type', '<img src=x onerror=alert(1)>').includes('<img'));
});

test('paintTypeColors paints each data-type-color chip through the CSSOM, never a style attribute', () => {
  const painted = [];
  const chip = (color) => ({ dataset: { typeColor: color }, style: {}, setAttribute() { throw new Error('no attributes'); } });
  const chips = [chip('#a371f7'), chip('tomato')];
  const root = { querySelectorAll(sel) { painted.push(sel); return chips; } };
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fn('paintTypeColors'), sandbox);
  sandbox.paintTypeColors(root);
  assert.deepStrictEqual(painted, ['[data-type-color]']);
  assert.strictEqual(chips[0].style.color, '#a371f7');
  assert.strictEqual(chips[0].style.borderColor, '#a371f7');
  assert.strictEqual(chips[1].style.color, 'tomato');
});

test('board tiles and archived tiles both render the chip in the head row, then paint its color', () => {
  for (const name of ['cardEl', 'archiveCardEl']) {
    const body = fn(name);
    const head = body.match(/<div class="card-head">[^\n]*<\/div>/);
    assert.ok(head, `${name} has a card-head row`);
    assert.match(head[0], /\$\{typeBadge\(card, state\.types\)\}/, `${name} puts the type chip in the head`);
    assert.match(body, /paintTypeColors\(el\)/, `${name} paints configured colors after innerHTML lands`);
    assert.ok(body.indexOf('paintTypeColors(el)') > body.indexOf('el.innerHTML ='), `${name} paints after insertion`);
  }
});

test('the detail popup paints the chip colors after rendering its frontmatter table', () => {
  const body = fn('openDetailModal');
  const render = body.indexOf("$('#detail-frontmatter').innerHTML");
  const paint = body.indexOf("paintTypeColors($('#detail-frontmatter'))");
  assert.ok(render > -1 && paint > render);
});

test('the board payload\'s types land in state before the first render, with an old-server fallback', () => {
  assert.match(appSrc, /^const state = \{[^\n]*\btypes: \[\]/m, 'state is seeded with types');
  const body = fn('applyBoardData');
  const set = body.indexOf('state.types = data.types || [];');
  assert.ok(set > -1, 'applyBoardData stores data.types defensively');
  assert.ok(set < body.indexOf('renderBoard();'), 'types are in place before renderBoard paints chips');
});

test('app.css styles the chip with tokens only, and the configured color is never CSS', () => {
  const rule = css.match(/\.type-chip\s*\{[^}]*\}/);
  assert.ok(rule, '.type-chip rule exists');
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/, 'no hex literal outside the token blocks');
  assert.match(rule[0], /var\(--/);
});
