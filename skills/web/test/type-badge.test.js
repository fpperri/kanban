const { test } = require('node:test');
const assert = require('node:assert');
const { typeBadge, typeColor } = require('../web/type-badge');

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
