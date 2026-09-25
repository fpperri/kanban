const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { cardMention, firstSentenceEnd, splitClauses, inlineTokens } = require('../web/prose');
const { escapeHtml } = require('../web/assignee-badge.js');

// --- card mentions ---------------------------------------------------------
test('cardMention reads the board and id a mention code span opens with', () => {
  assert.deepStrictEqual(cardMention('kanban.proj#267 EPIC: one design system every surface inlines'), { board: 'kanban.proj', id: 267 });
  assert.deepStrictEqual(cardMention('webapp#12'), { board: 'webapp', id: 12 });
});

test('cardMention ignores code that is not a mention', () => {
  for (const s of ['git status --porcelain', '#12 title', 'webapp #12', 'a#b', 'README.md', '', null]) {
    assert.strictEqual(cardMention(s), null, `${JSON.stringify(s)} is not a mention`);
  }
});

// --- sentences and clauses ---------------------------------------------------
test('firstSentenceEnd stops after the first real sentence', () => {
  const s = 'One thing happened. Then another.';
  assert.strictEqual(s.slice(0, firstSentenceEnd(s)), 'One thing happened.');
  assert.strictEqual(firstSentenceEnd('No boundary here'), -1);
  assert.strictEqual(firstSentenceEnd('Ends at the end.'), -1, 'a final full stop has no sentence after it');
});

test('splitClauses breaks at top-level semicolons and keeps each ;', () => {
  assert.deepStrictEqual(splitClauses('first part; second part; third'), ['first part;', 'second part;', 'third']);
});

test('splitClauses never splits inside code, quotes or parentheses', () => {
  assert.deepStrictEqual(splitClauses('ran `a; b` there; then "x; y" said; (p; q) held'), ['ran `a; b` there;', 'then "x; y" said;', '(p; q) held']);
  assert.deepStrictEqual(splitClauses('a;b stays joined'), ['a;b stays joined']);
});

test('inlineTokens finds code spans and bold, and nothing else', () => {
  assert.deepStrictEqual(inlineTokens('see `a.js` and **this** now'), [
    { t: 'text', v: 'see ' }, { t: 'code', v: 'a.js' }, { t: 'text', v: ' and ' }, { t: 'strong', v: 'this' }, { t: 'text', v: ' now' },
  ]);
  assert.deepStrictEqual(inlineTokens('<b>raw</b>'), [{ t: 'text', v: '<b>raw</b>' }], 'markup stays text for the DOM builder');
});

// --- the card body renderer ---------------------------------------------------
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
function loadMd(projectName) {
  const helpers = appSrc.match(/const TABLE_DELIM_RE = [\s\S]*?\n\}/)[0];
  const fn = appSrc.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
  const sandbox = { escapeHtml, cardMention, state: { projectName } };
  vm.createContext(sandbox);
  vm.runInContext(`${helpers}\n${fn}`, sandbox);
  return sandbox.mdToHtml;
}

test('a mention code span renders as a chip; one on this board carries its id for the click', () => {
  const md = loadMd('webapp');
  assert.ok(md('see `webapp#12 Retry budget`').includes('<code class="mention same" data-card-id="12" tabindex="0" role="link">webapp#12 Retry budget</code>'));
  assert.ok(md('see `other#3 Title`').includes('<code class="mention">other#3 Title</code>'));
  assert.ok(md('run `git status`').includes('<code>git status</code>'), 'ordinary code stays code');
});

test('a hostile mention stays escaped', () => {
  const md = loadMd('webapp');
  const html = md('`webapp#1 <img src=x onerror=alert(1)>`');
  assert.ok(!html.includes('<img'), 'no live tag');
  assert.ok(html.includes('&lt;img'), 'rendered as text');
});

test('task items carry their tick in its own span, marked done or open', () => {
  const md = loadMd('webapp');
  const html = md('- [x] shipped\n- [ ] pending');
  assert.ok(html.includes('<li class="task done"><span class="tick">&#9745;</span> shipped'));
  assert.ok(html.includes('<li class="task open"><span class="tick">&#9744;</span> pending'));
});

// --- the frontmatter's board marks -------------------------------------------
function loadFrontmatter(projectName, assignees) {
  const pick = (re) => { const m = appSrc.match(re); assert.ok(m, `${re} found in app.js`); return m[0]; };
  const src = [
    pick(/function formatLocalDateTime\([\s\S]*?\n\}/),
    pick(/const LOCAL_DATETIME_VALUE_RE = [^\n]*\n/),
    pick(/function formatFrontmatterValue\([\s\S]*?\n\}/),
    pick(/function frontmatterValueHtml\([\s\S]*?\n\}/),
  ].join('\n');
  const sandbox = {
    escapeHtml,
    ...require('../web/waiting-blocked'),
    statusColorClass: require('../web/status-colors').statusColorClass,
    assigneeBadge: require('../web/assignee-badge').assigneeBadge,
    state: { projectName, assignees },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.frontmatterValueHtml;
}

test('frontmatter values the board understands wear its own marks', () => {
  const fm = loadFrontmatter('cortex4.proj', []);
  assert.match(fm('status', 'doing'), /class="fm-status fm-status--doing"><span class="status-dot status-dot--doing"><\/span>doing/);
  assert.strictEqual(fm('priority', 'High'), '<span class="fm-high">High</span>');
  assert.match(fm('assignee', '"@hitl"'), /class="card-assignee assignee-text--palette-\d"[^>]*>@hitl</);
  assert.strictEqual(fm('parent', '1'), '<code class="mention same" data-card-id="1" tabindex="0" role="link">cortex4.proj#1</code>');
  assert.strictEqual(fm('blocked', 'true'), '<span class="fm-sticker fm-sticker--blocked">blocked</span>', 'a reason-less sticker shows its bare name');
  assert.strictEqual(fm('review', 'no'), 'no', 'a cleared sticker prints as written');
  assert.strictEqual(fm('review', '"read the table"'), '<span class="fm-sticker fm-sticker--review">read the table</span>');
  assert.strictEqual(fm('tags', '[v4, shop]'), '<span class="tag">v4</span><span class="tag">shop</span>');
  assert.strictEqual(fm('start_date', '2026-09-24'), '2026-09-24');
  assert.strictEqual(fm('updated', '2026-09-24T18:38:04'), '2026-09-24 | 18:38:04');
});

test('frontmatter values stay escaped on every path', () => {
  const fm = loadFrontmatter('<b>board</b>', []);
  const evil = '<img src=x onerror=alert(1)>';
  for (const k of ['status', 'priority', 'assignee', 'review', 'blocked', 'tags', 'title', 'parent']) {
    const out = fm(k, k === 'tags' ? `[${evil}]` : evil);
    assert.ok(!out.includes('<img'), `${k}: a hostile value never becomes a tag`);
  }
  assert.ok(!fm('parent', '7').includes('<b>'), 'the board name is escaped inside the parent chip');
  assert.ok(!fm('parent', '7 <b>x</b>').includes('<b>'), 'a non-numeric parent prints escaped, as written');
});

test('a board name with markup characters still gets clickable mentions', () => {
  const md = loadMd('r&d');
  assert.ok(md('`r&d#4 t`').includes('class="mention same" data-card-id="4"'), 'escaped text is compared with the escaped name');
});

test('a mention inside a link URL leaves the link as text instead of breaking its attributes', () => {
  const md = loadMd('webapp');
  const html = md('[see](http://x.test/`webapp#5 t`) done');
  assert.ok(!/<a [^>]*href="[^"]*<code/.test(html), 'no chip inside an href');
  assert.ok(!html.includes('<a '), 'the link is not built at all');
  assert.ok(md('[see](https://x.test/a) done').includes('<a href="https://x.test/a" target="_blank" rel="noopener noreferrer">see</a>'), 'ordinary links still work');
});

test('mention chips open their card by click and by Enter, from the popup and from the tray', () => {
  assert.match(appSrc, /\$\('#detail-modal'\)\.addEventListener\('click', openMentionedCard\)/);
  assert.match(appSrc, /\$\('#detail-modal'\)\.addEventListener\('keydown', openMentionedCard\)/);
  assert.match(appSrc, /\$\('#notif-list'\)\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Enter'\) openMentionFromTray\(e\); \}\)/);
  const tray = appSrc.match(/async function openMentionFromTray\([\s\S]*?\n\}/)[0];
  // openCard (not openDetailModal directly): opening from the tray is a
  // history step too, same as every other user-gesture open.
  const openIdx = tray.indexOf('await openCard');
  const closeIdx = tray.indexOf('closeNotifModal');
  assert.ok(openIdx > -1, 'openMentionFromTray no longer opens via openCard');
  assert.ok(closeIdx > -1, 'openMentionFromTray no longer closes the tray');
  assert.ok(openIdx < closeIdx, 'the tray closes only after the card has loaded');
});
