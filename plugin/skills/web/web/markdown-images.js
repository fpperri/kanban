'use strict';
// A card's Markdown images on the page. The renderer (markdown.js) draws a picture only where it is
// given the address to load it from; this is that address, the server's route for one card's image
// (GET /api/cards/<id>/image?path=), and the one place a picture the server refused or could not find
// is swapped for its alt text as a plain label. The page's CSP has no unsafe-inline, so there is no
// onerror attribute: an error does not bubble, so one listener on the document captures it.

function cardImageSrc(card, path) {
  // A board that holds no pictures (the board load says `source.pictures: false`: a page that carries its
  // board keeps text files only) gives no address, so the renderer draws the alt text and nothing asks for
  // a file that is not there.
  if (state.source && state.source.pictures === false) return '';
  return `/api/cards/${encodeURIComponent(card)}/image?path=${encodeURIComponent(path)}`;
}

document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || typeof img.matches !== 'function') return;
  // A body picture sits in its link; the Scratchpad folder browser's picture (img.spf-img) stands alone.
  const link = img.matches('img.md-img-pic') ? img.closest('a.md-img') : img.matches('img.spf-img') ? img : null;
  if (!link) return;
  const label = img.ownerDocument.createElement('span');
  label.className = 'md-img-alt';
  label.textContent = img.alt;
  link.replaceWith(label);
}, true);
