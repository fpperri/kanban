'use strict';
// The phone header's More menu. Under 760 px the header's top row is the board name, New card, the
// view buttons, the bell and a More button; the menu holds what the desktop header shows beside
// them: Preferences, Refresh, Copy board path, the home link and the iteration picker, each only
// when the desktop shows it. The items are static markup in app.html; this file shows and hides
// them and acts through the handlers the desktop buttons already have (a choice clicks the gear,
// Refresh or the copy button; the picker sets #iter-select and fires its change). The stylesheet
// shows the button and the menu only under the line (phone-width.js), so nothing is built or moved
// when a window crosses it; a menu left open when the window grows past the line is closed.
//
// moreMenuItems is pure; the rest reads the page's $ at the moment it runs. Same dual-environment
// export pattern as phone-width.js.

function moreMenuItems({ home = false, iterations = false } = {}) {
  const items = ['prefs', 'refresh', 'copy'];
  if (home) items.push('home');
  if (iterations) items.push('iteration');
  return items;
}

const MORE_MENU_NODES = { prefs: '#more-prefs', refresh: '#more-refresh', copy: '#more-copy', home: '#more-home', iteration: '#more-iter' };
const MORE_MENU_DESKTOP_BUTTONS = { prefs: '#prefs-btn', refresh: '#refresh-btn', copy: '#board-copy-btn' };

const moreMenuState = { open: false };

function moreMenuIsOpen() {
  return moreMenuState.open;
}

function moreMenuSync() {
  const home = $('#home-link');
  const pick = $('#iter-select');
  const homeOn = !home.classList.contains('hidden');
  const iterationsOn = !pick.hidden;
  const listed = moreMenuItems({ home: homeOn, iterations: iterationsOn });
  for (const [item, selector] of Object.entries(MORE_MENU_NODES)) $(selector).classList.toggle('hidden', !listed.includes(item));
  if (homeOn) $('#more-home').href = home.href;
  if (iterationsOn) {
    const mine = $('#more-iter-select');
    mine.replaceChildren(...[...pick.options].map((o) => {
      const copy = document.createElement('option');
      copy.value = o.value;
      copy.textContent = o.textContent;
      return copy;
    }));
    mine.value = pick.value;
  }
}

function moreMenuOpen() {
  moreMenuSync();
  moreMenuState.open = true;
  $('#more-menu').classList.remove('hidden');
  $('#more-btn').setAttribute('aria-expanded', 'true');
}

function moreMenuClose() {
  if (!moreMenuIsOpen()) return false;
  moreMenuState.open = false;
  $('#more-menu').classList.add('hidden');
  $('#more-btn').setAttribute('aria-expanded', 'false');
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { moreMenuItems };
} else {
  window.moreMenuItems = moreMenuItems;
  window.addEventListener('DOMContentLoaded', () => {
    $('#more-btn').addEventListener('click', () => { if (moreMenuIsOpen()) moreMenuClose(); else moreMenuOpen(); });
    for (const [item, selector] of Object.entries(MORE_MENU_DESKTOP_BUTTONS)) {
      $(`#more-${item}`).addEventListener('click', () => { moreMenuClose(); $(selector).click(); });
    }
    $('#more-home').addEventListener('click', () => { moreMenuClose(); });
    $('#more-iter-select').addEventListener('change', () => {
      const pick = $('#iter-select');
      pick.value = $('#more-iter-select').value;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      moreMenuClose();
    });
    document.addEventListener('click', (e) => {
      if (moreMenuIsOpen() && !e.target.closest('#more-btn, #more-menu')) moreMenuClose();
    });
    window.addEventListener('resize', () => {
      if (moreMenuIsOpen() && !window.matchMedia(PHONE_WIDTH_QUERY).matches) moreMenuClose();
    });
  });
}
