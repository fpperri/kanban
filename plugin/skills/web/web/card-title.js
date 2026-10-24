'use strict';
// Pure helper for the board tile's title display: a card
// born with a `prompt` but no title yet (an AI-dispatched card waiting on a
// title of its own) shows the prompt text itself as a temporary stand-in, so
// the tile never renders visually blank while that's pending. Same
// dual-environment pattern as priority-badge.js/assignee-badge.js — no DOM
// access, loaded as a plain <script> in the browser (app.js calls
// cardTitleDisplay as a bare global) AND required directly by node --test.

function cardTitleDisplay(card) {
  const title = String(card.title || '').trim();
  if (title) return { text: card.title, isPromptFallback: false };
  const prompt = String(card.prompt || '').trim();
  return { text: prompt, isPromptFallback: Boolean(prompt) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cardTitleDisplay };
} else {
  window.cardTitleDisplay = cardTitleDisplay;
}
