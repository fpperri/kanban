const { test } = require('node:test');
const assert = require('node:assert');
const { typeBadge, typeColor } = require('../../plugin/skills/web/web/type-badge');

const TYPES = [
  { name: 'objective', color: '#a371f7' },
  { name: 'story', color: '' },
];

test('typeBadge renders nothing for a card without a type (null, undefined, blank)', () => {
  assert.strictEqual(typeBadge({ type: null }, TYPES), '');
  assert.strictEqual(typeBadge({}, TYPES), '');
  assert.strictEqual(typeBadge({ type: '' }, TYPES), '');
  assert.strictEqual(typeBadge({ type: '   ' }, TYPES), '');
});

test('a type listed with a color renders a chip carrying that color for the CSSOM pass', () => {
  const html = typeBadge({ type: 'objective' }, TYPES);
  assert.strictEqual(html, '<span class="type-chip" title="objective" data-type-color="#a371f7">objective</span>');
});

test('a type listed without a color renders a neutral chip: no color attribute', () => {
  const html = typeBadge({ type: 'story' }, TYPES);
  assert.strictEqual(html, '<span class="type-chip" title="story">story</span>');
});

test('a type missing from the list renders a neutral chip, the text kept as typed', () => {
  assert.strictEqual(typeBadge({ type: 'Spike' }, TYPES), '<span class="type-chip" title="Spike">Spike</span>');
});

test('the chip renders with no types list at all (old server, no config)', () => {
  assert.strictEqual(typeBadge({ type: 'objective' }), '<span class="type-chip" title="objective">objective</span>');
  assert.strictEqual(typeBadge({ type: 'objective' }, []), '<span class="type-chip" title="objective">objective</span>');
  assert.strictEqual(typeBadge({ type: 'objective' }, null), '<span class="type-chip" title="objective">objective</span>');
});

test('the list only suggests: names match case-insensitively and ignoring surrounding space, the chip keeps the card\'s own text', () => {
  const html = typeBadge({ type: '  Objective ' }, TYPES);
  assert.match(html, /data-type-color="#a371f7"/);
  assert.match(html, />Objective<\/span>$/);
});

test('typeColor looks a type up by name and answers an empty string when there is no color to wear', () => {
  assert.strictEqual(typeColor('objective', TYPES), '#a371f7');
  assert.strictEqual(typeColor('story', TYPES), '');
  assert.strictEqual(typeColor('nope', TYPES), '');
  assert.strictEqual(typeColor('objective', undefined), '');
});

test('typeBadge escapes the type text, the tooltip and a hostile color value', () => {
  const html = typeBadge({ type: '<b>&"\'' }, [{ name: '<b>&"\'', color: '"><script>x</script>' }]);
  assert.doesNotMatch(html, /<b>|<script>/);
  assert.match(html, /title="&lt;b&gt;&amp;&quot;&#39;"/);
  assert.match(html, /data-type-color="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
  assert.match(html, />&lt;b&gt;&amp;&quot;&#39;<\/span>$/);
});

test('the chip never carries an inline style attribute (strict CSP)', () => {
  assert.doesNotMatch(typeBadge({ type: 'objective' }, TYPES), /style=/);
});

// --- icons ---------------------------------------------------------------------

const ICON_TYPES = [
  { name: 'objective', color: '#a371f7', icon: 'diamond' },
  { name: 'story', color: '', icon: 'circle' },
  { name: 'epic', color: '', icon: 'star' },
  { name: 'bug', color: '#f85149', icon: 'blob' },
];
const glyph = (g) => `<span class="type-icon" aria-hidden="true">${g}</span>`;

test('a type with an icon gives a chip that starts with that glyph, and the chip keeps its colour for the glyph to inherit', () => {
  assert.strictEqual(typeBadge({ type: 'objective' }, ICON_TYPES),
    `<span class="type-chip" title="objective" data-type-color="#a371f7">${glyph('\u25c6')}objective</span>`);
  assert.strictEqual(typeBadge({ type: 'story' }, ICON_TYPES),
    `<span class="type-chip" title="story">${glyph('\u25cf')}story</span>`);
});

test('each of the six icons puts its own glyph on the chip', () => {
  const six = [['circle', '\u25cf'], ['square', '\u25a0'], ['diamond', '\u25c6'], ['triangle', '\u25b2'], ['hexagon', '\u2b22'], ['star', '\u2605']];
  for (const [icon, g] of six) {
    assert.strictEqual(typeBadge({ type: 't' }, [{ name: 't', color: '', icon }]), `<span class="type-chip" title="t">${glyph(g)}t</span>`, icon);
  }
});

test('the glyph is a decoration: the tooltip stays the type text and the glyph is hidden from a screen reader', () => {
  const html = typeBadge({ type: 'Epic' }, ICON_TYPES);
  assert.match(html, /^<span class="type-chip" title="Epic">/);
  assert.match(html, /<span class="type-icon" aria-hidden="true">/);
});

test('a type with an unknown icon name gives the chip it gave before icons, byte for byte', () => {
  const before = '<span class="type-chip" title="bug" data-type-color="#f85149">bug</span>';
  assert.strictEqual(typeBadge({ type: 'bug' }, ICON_TYPES), before);
  assert.strictEqual(typeBadge({ type: 'bug' }, [{ name: 'bug', color: '#f85149' }]), before);
});

test('a type with no icon, and one the list does not know, give the chip they gave before icons', () => {
  assert.strictEqual(typeBadge({ type: 'story' }, [{ name: 'story', color: '' }]), '<span class="type-chip" title="story">story</span>');
  assert.strictEqual(typeBadge({ type: 'Spike' }, ICON_TYPES), '<span class="type-chip" title="Spike">Spike</span>');
  assert.strictEqual(typeBadge({ type: 'epic' }), '<span class="type-chip" title="epic">epic</span>');
});

test('a hostile icon name never reaches the markup: the chip is the plain one', () => {
  for (const icon of ['"><script>x</script>', '<img src=x onerror=alert(1)>', '__proto__', 'constructor', 'STAR', 'star" onclick="x', 7, {}, ['star']]) {
    const html = typeBadge({ type: 'epic' }, [{ name: 'epic', color: '', icon }]);
    assert.strictEqual(html, '<span class="type-chip" title="epic">epic</span>', JSON.stringify(icon));
  }
});

test('with an icon the type text and a hostile colour stay escaped, and no style attribute appears', () => {
  const html = typeBadge({ type: '<b>&"\'' }, [{ name: '<b>&"\'', color: '"><script>x</script>', icon: 'hexagon' }]);
  assert.doesNotMatch(html, /<b>|<script>/);
  assert.doesNotMatch(html, /style=/);
  assert.match(html, />&lt;b&gt;&amp;&quot;&#39;<\/span>$/);
  assert.match(html, /data-type-color="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
});
