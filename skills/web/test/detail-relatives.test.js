const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const html = read('app.html');
const css = read('app.css');

function fn(name) {
  const m = appSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, title: `Card ${id}`, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);

function loadRelatives() {
  const sandbox = {
    escapeHtml: require('../web/assignee-badge').escapeHtml,
    cardTitleDisplay: require('../web/card-title').cardTitleDisplay,
    ...require('../web/nesting'),
  };
  vm.createContext(sandbox);
  vm.runInContext([fn('relativeMentionHtml'), fn('threadEntryHtml'), fn('childEntryHtml'), fn('detailRelativesHtml')].join('\n'), sandbox);
  return (cards, id) => sandbox.detailRelativesHtml(cards, id, CTX);
}

const chip = (id, title) => `<code class="mention same" data-card-id="${id}" tabindex="0" role="link">kanban#${id} ${title}</code>`;

test('a story three levels down shows three parents above it, root first, each one a click target', () => {
  const rel = loadRelatives();
  const cards = [card(1, { title: 'Strategy' }), card(2, { parent: 1, title: 'Objective' }), card(3, { parent: 2, title: 'Epic' }), card(4, { parent: 3, title: 'Story' })];
  const { threadHtml } = rel(cards, 4);
  const at = (id) => threadHtml.indexOf(chip(id, cards[id - 1].title));
  assert.ok(at(1) !== -1 && at(2) !== -1 && at(3) !== -1, 'all three parents are mention chips that open on click');
  assert.ok(at(1) < at(2) && at(2) < at(3), 'root first');
  assert.ok(!threadHtml.includes('data-card-id="4"'), 'the card itself is not in its own thread');
});

test('a root has no thread, and a card with no children no child list', () => {
  const rel = loadRelatives();
  const out = rel([card(1)], 1);
  assert.strictEqual(out.threadHtml, '');
  assert.strictEqual(out.childrenHtml, '');
});

test('a parent\'s detail lists its children in rank order, unranked after, archived included', () => {
  const rel = loadRelatives();
  const cards = [
    card(1, { title: 'Parent' }),
    card(5, { parent: 1, rank: 30, title: 'Third' }),
    card(6, { parent: 1, title: 'Loose', priority: 'Low' }),
    card(3, { parent: 1, rank: 10, title: 'First' }),
    card(4, { parent: 1, rank: 20, title: 'Second', archived: true }),
    card(7, { parent: 99, rank: 1, title: 'Elsewhere' }),
  ];
  const { childrenHtml } = rel(cards, 1);
  const ids = [...childrenHtml.matchAll(/data-card-id="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(ids, [3, 4, 5, 6]);
  assert.strictEqual((childrenHtml.match(/child-item--archived/g) || []).length, 1, 'only the archived child is marked');
  assert.match(childrenHtml, />archived</);
});

test('a card whose parent id does not exist shows an unresolved marker', () => {
  const rel = loadRelatives();
  const { threadHtml } = rel([card(4, { parent: 99 })], 4);
  assert.match(threadHtml, /thread-item--unresolved/);
  assert.match(threadHtml, />unresolved</);
  assert.match(threadHtml, /kanban#99/);
  assert.ok(!threadHtml.includes('data-card-id'), 'a card that is not there cannot be clicked');
});

test('a parent on another board shows its mention marked as not followed, and cannot be clicked', () => {
  const rel = loadRelatives();
  const { threadHtml } = rel([card(4, { parent: 'fpp#4' })], 4);
  assert.match(threadHtml, /<code class="mention">fpp#4<\/code>/);
  assert.match(threadHtml, /thread-item--other-board/);
  assert.match(threadHtml, />not followed</);
  assert.ok(!threadHtml.includes('data-card-id'));
  assert.ok(!threadHtml.includes('unresolved'), 'another board\'s card is not an unresolved one');
});

test('a missing id here and a card on another board read as two different markers', () => {
  const rel = loadRelatives();
  assert.match(rel([card(4, { parent: 99 })], 4).threadHtml, /unresolved/);
  assert.match(rel([card(4, { parent: 'fpp#99' })], 4).threadHtml, /not followed/);
});

test('two cards that name each other as parent show a loop flag and return', () => {
  const rel = loadRelatives();
  const cards = [card(1, { parent: 2, title: 'One' }), card(2, { parent: 1, title: 'Two' })];
  const { threadHtml } = rel(cards, 1);
  assert.match(threadHtml, /thread-item--loop/);
  assert.match(threadHtml, />loop</);
  assert.ok(threadHtml.includes(chip(2, 'Two')), 'the other card of the pair is still in the thread');
  const { threadHtml: self } = rel([card(7, { parent: 7 })], 7);
  assert.match(self, />loop</, 'a card that names itself is a loop too');
});

test('a card with no title shows its prompt in the thread and the child list', () => {
  const rel = loadRelatives();
  const cards = [card(1, { title: '', prompt: 'write the thing' }), card(2, { parent: 1, title: '', prompt: 'sub step' })];
  assert.ok(rel(cards, 2).threadHtml.includes('kanban#1 write the thing'));
  assert.ok(rel(cards, 1).childrenHtml.includes('kanban#2 sub step'));
});

test('hostile titles and board names stay escaped in the thread and the child list', () => {
  const rel = loadRelatives();
  const evil = '<img src=x onerror=alert(1)>';
  const cards = [card(1, { title: evil }), card(2, { parent: 1, title: evil }), card(3, { parent: '<b>x</b>#4' })];
  const asChild = rel(cards, 1).childrenHtml;
  const asParent = rel(cards, 2).threadHtml;
  const elsewhere = rel(cards, 3).threadHtml;
  for (const out of [asChild, asParent, elsewhere]) {
    assert.ok(!out.includes('<img') && !out.includes('<b>'), 'no live markup');
  }
  assert.ok(asChild.includes('&lt;img'));
  assert.ok(asParent.includes('&lt;img'));
  assert.ok(elsewhere.includes('&lt;b&gt;x&lt;/b&gt;#4'));
});

// --- wiring -------------------------------------------------------------------

test('app.html puts the thread between the header and the frontmatter, and the children after the body', () => {
  const header = html.indexOf('class="detail-header popup-header"');
  const thread = html.indexOf('id="detail-thread"');
  const front = html.indexOf('id="detail-frontmatter"');
  const body = html.indexOf('id="detail-body"');
  const children = html.indexOf('id="detail-children"');
  assert.ok(header !== -1 && thread !== -1 && front !== -1 && body !== -1 && children !== -1, 'all five anchors exist');
  assert.ok(header < thread && thread < front && front < body && body < children);
  assert.match(html, /id="detail-thread" class="detail-thread hidden"/);
  assert.match(html, /id="detail-children" class="detail-children hidden"/);
});

test('openDetailModal fills both containers from the loaded board, after the body', () => {
  const open = fn('openDetailModal');
  assert.ok(open.indexOf("$('#detail-body').innerHTML") < open.indexOf('renderDetailRelatives('));
  const render = fn('renderDetailRelatives');
  assert.match(render, /state\.active\.concat\(state\.archived\)/);
  assert.match(render, /state\.projectName/);
  assert.match(render, /#detail-thread/);
  assert.match(render, /#detail-children/);
  assert.match(render, /classList\.toggle\('hidden'/, 'an empty container is hidden');
});

test('the entries ride the existing mention listener: no second click handler is added', () => {
  assert.strictEqual(appSrc.split("addEventListener('click', openMentionedCard)").length - 1, 1);
  assert.ok(!/#detail-(thread|children)'\)\.addEventListener/.test(appSrc));
});

test('the helpers escape and carry no inline style', () => {
  const src = fn('relativeMentionHtml') + fn('threadEntryHtml') + fn('childEntryHtml');
  assert.ok(src.includes('escapeHtml('));
  assert.ok(!/style=/.test(src));
});

test('the mention colours reach the thread and the child list', () => {
  const m = css.match(/\n([^\n{]*code\.mention[^\n{]*) \{ color: var\(--accent\); background: var\(--accent-soft\); \}/);
  assert.ok(m, 'the mention colour rule exists');
  assert.ok(m[1].includes('.detail-thread code.mention'));
  assert.ok(m[1].includes('.detail-children code.mention'));
});

test('the thread, its markers and the child list are styled with tokens, not hex', () => {
  for (const sel of ['.detail-thread', '.rel-mark', '.children-list']) {
    const re = new RegExp('(^|\\n)' + sel.replace('.', '\\.') + ' \\{([^}]*)\\}');
    const m = re.exec(css);
    assert.ok(m, `${sel} rule exists`);
    assert.doesNotMatch(m[2], /#[0-9a-fA-F]{3,8}\b/);
  }
});

test('the web skill documents the thread, the children and the three terminal markers', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = skill.indexOf('- **Thread and children**');
  assert.ok(start !== -1, 'a Thread and children bullet');
  const bullet = skill.slice(start, skill.indexOf('\n- **', start + 4)).replace(/\s+/g, ' ');
  for (const word of ['root first', '`unresolved`', '`not followed`', '`loop`', 'rank order', '`archived`']) {
    assert.ok(bullet.includes(word), `${word} is described`);
  }
});
