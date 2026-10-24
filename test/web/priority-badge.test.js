const { test } = require('node:test');
const assert = require('node:assert');
const { priorityBadge } = require('../web/priority-badge');

// emphasis comes from the card's rank in the configured priorities
// list — no hardcoded 'High' string checks. First = hot, last (of a 3+ list)
// = muted, everything else (middle, unknown) = neutral.

test('first-in-list priority is hot: high card class and an uppercased label', () => {
  assert.deepStrictEqual(priorityBadge({ priority: 'High' }, []), { className: 'high', label: 'HIGH' });
});

test('middle priority is neutral: no class, no label', () => {
  assert.deepStrictEqual(priorityBadge({ priority: 'Normal' }, []), { className: '', label: '' });
});

test('last of a 3+ list is muted: low card class and an uppercased label', () => {
  assert.deepStrictEqual(priorityBadge({ priority: 'Low' }, []), { className: 'low', label: 'LOW' });
});

test('unknown priority is neutral', () => {
  assert.deepStrictEqual(priorityBadge({ priority: 'Weird' }, []), { className: '', label: '' });
});

test('a configured list drives emphasis — its own first is hot, its last is muted', () => {
  const list = ['P0', 'P1', 'P2'];
  assert.deepStrictEqual(priorityBadge({ priority: 'P0' }, list), { className: 'high', label: 'P0' });
  assert.deepStrictEqual(priorityBadge({ priority: 'P2' }, list), { className: 'low', label: 'P2' });
  assert.deepStrictEqual(priorityBadge({ priority: 'High' }, list), { className: '', label: '' });
});

test('a two-item list has no muted tier — its last entry stays neutral', () => {
  assert.deepStrictEqual(priorityBadge({ priority: 'Normal' }, ['High', 'Normal']), { className: '', label: '' });
});

test('label is HTML-escaped for direct interpolation', () => {
  const b = priorityBadge({ priority: '<b>&' }, ['<b>&', 'x', 'y']);
  assert.strictEqual(b.label, '&lt;B&gt;&amp;');
});
