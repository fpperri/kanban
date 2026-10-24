const { test } = require('node:test');
const assert = require('node:assert');
const { cardTitleDisplay } = require('../web/card-title');

test('cardTitleDisplay returns the real title untouched when present, ignoring any prompt', () => {
  assert.deepStrictEqual(
    cardTitleDisplay({ title: 'Ship it', prompt: 'ignored' }),
    { text: 'Ship it', isPromptFallback: false },
  );
});

test('cardTitleDisplay falls back to the prompt when the title is empty', () => {
  assert.deepStrictEqual(
    cardTitleDisplay({ title: '', prompt: 'summarize the PR' }),
    { text: 'summarize the PR', isPromptFallback: true },
  );
});

test('cardTitleDisplay falls back to the prompt when the title is whitespace-only', () => {
  assert.deepStrictEqual(
    cardTitleDisplay({ title: '   ', prompt: 'do the thing' }),
    { text: 'do the thing', isPromptFallback: true },
  );
});

test('cardTitleDisplay returns blank text with no fallback flag when both title and prompt are empty', () => {
  assert.deepStrictEqual(cardTitleDisplay({ title: '', prompt: '' }), { text: '', isPromptFallback: false });
});

test('cardTitleDisplay treats a null/undefined prompt like an absent one', () => {
  assert.deepStrictEqual(cardTitleDisplay({ title: '', prompt: null }), { text: '', isPromptFallback: false });
  assert.deepStrictEqual(cardTitleDisplay({ title: '' }), { text: '', isPromptFallback: false });
});

test('cardTitleDisplay treats a whitespace-only prompt as no fallback either', () => {
  assert.deepStrictEqual(cardTitleDisplay({ title: '', prompt: '   ' }), { text: '', isPromptFallback: false });
});
