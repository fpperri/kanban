const { test } = require('node:test');
const assert = require('node:assert');
const { assigneeBadge, escapeHtml, resolveAssignees, DEFAULT_ASSIGNEES } = require('../web/assignee-badge');
const { assigneeColorClass, assigneeColor } = require('../web/assignee-colors');

// --- the badge tints the handle text, no dot glyph ---------

test('assigneeBadge renders an escaped span with a tinted handle when assignee is set', () => {
  const html = assigneeBadge({ assignee: '@alex' }, []);
  const cls = assigneeColorClass('@alex', []);
  assert.match(html, new RegExp(`^<span class="card-assignee assignee-text--${cls}" title="@alex">`), 'hashed color rides an assignee-text--palette-N class, not a dot');
  assert.match(html, />@alex<\/span>$/);
  assert.doesNotMatch(html, /<span class="assignee-dot/, 'no dot glyph');
  assert.doesNotMatch(html, /data-assignee-color/, 'no CSSOM hook needed for the hashed case');
});

test('assigneeBadge still renders (unregistered/no registry passed) — assignees param is optional', () => {
  const html = assigneeBadge({ assignee: '@alex' });
  assert.match(html, /class="card-assignee assignee-text--palette-\d"/);
});

test('assigneeBadge carries a data-assignee-color attribute on the span itself for a RESERVED custom color — no fixed class exists for an arbitrary hex', () => {
  const assignees = [{ handle: '@alex', color: '#ff00ff' }];
  const html = assigneeBadge({ assignee: '@alex' }, assignees);
  assert.match(html, /^<span class="card-assignee" title="@alex" data-assignee-color="#ff00ff">/);
  assert.doesNotMatch(html, /assignee-text--palette/, 'a reserved color never rides a hashed class');
});

test('assigneeBadge escapes a hostile reserved color value in the data attribute', () => {
  const assignees = [{ handle: '@alex', color: '"><script>x</script>' }];
  const html = assigneeBadge({ assignee: '@alex' }, assignees);
  assert.doesNotMatch(html, /<script>x<\/script>"/);
  assert.match(html, /data-assignee-color="&quot;&gt;&lt;script&gt;x&lt;\/script&gt;"/);
});

test('assigneeBadge tooltips the handle and escapes it in both the title and the text', () => {
  const html = assigneeBadge({ assignee: '<b>&"\'' }, []);
  assert.match(html, /title="&lt;b&gt;&amp;&quot;&#39;"/);
  assert.match(html, />&lt;b&gt;&amp;&quot;&#39;<\/span>$/);
});

test('assigneeBadge escapes &, <, >, ", and \' in the assignee value', () => {
  const html = assigneeBadge({ assignee: '<b>&"\'' }, []);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;b&gt;&amp;&quot;&#39;/);
});

test('assigneeBadge returns empty string when assignee is null (server sends null for unset)', () => {
  assert.strictEqual(assigneeBadge({ assignee: null }), '');
});

test('assigneeBadge returns empty string when assignee is undefined', () => {
  assert.strictEqual(assigneeBadge({}), '');
});

test('assigneeBadge returns empty string when assignee is an empty string', () => {
  assert.strictEqual(assigneeBadge({ assignee: '' }), '');
});

test('escapeHtml escapes all five reserved characters', () => {
  assert.strictEqual(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

// --- registry-less boards fall back to the @human/@hitl/@afk trio ---

test('resolveAssignees falls back to the canonical role trio on an empty or absent registry', () => {
  assert.strictEqual(resolveAssignees([]), DEFAULT_ASSIGNEES);
  assert.strictEqual(resolveAssignees(null), DEFAULT_ASSIGNEES);
  assert.strictEqual(resolveAssignees(undefined), DEFAULT_ASSIGNEES);
});

test('DEFAULT_ASSIGNEES is exactly @human/@hitl/@afk with the canonical kinds, shaped like config-store entries', () => {
  assert.deepStrictEqual(DEFAULT_ASSIGNEES.map((a) => a.handle), ['@human', '@hitl', '@afk']);
  assert.deepStrictEqual(DEFAULT_ASSIGNEES.map((a) => a.kind), ['human', 'ai-hitl', 'ai-afk']);
  for (const a of DEFAULT_ASSIGNEES) {
    assert.deepStrictEqual(Object.keys(a).sort(), ['description', 'handle', 'kind', 'name']);
    assert.ok(a.name && a.description, `${a.handle} carries a name and description for the combobox label`);
  }
  assert.ok(!DEFAULT_ASSIGNEES.some((a) => a.handle === '@ai'), '"@ai" is retired as ambiguous');
});

test('resolveAssignees returns a configured registry untouched — registry wins, suggest-never-validate', () => {
  const registry = [{ handle: '@alex', name: 'Alex', kind: 'human', description: '' }];
  assert.strictEqual(resolveAssignees(registry), registry);
});

// applyAssignees itself lives in app.js (DOM code, not require-able) — pin the
// wiring at source level so the fallback can't silently detach from the form.
test('app.js applyAssignees routes the registry through resolveAssignees', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.match(src, /state\.assignees = resolveAssignees\(list\)/);
});
