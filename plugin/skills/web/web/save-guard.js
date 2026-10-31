'use strict';
// What the header's activity mark and the leaving guard read. makeSaveGuard counts the saves in flight
// (the page tracks every write api() sends, on every board source) and, for a downloaded file, how many of
// what its tray held at the last copy or save (the tray's fingerprint, page-source.js: its records whole, so an
// edit folded into a record already copied, or a record gone, shows). leaving() says why the page should ask
// before it goes: 'saving' while any save is in flight; 'unsent' when a file's tray is not what the last copy
// or save took. A Board artifact keeps its tray in its database and the desk Web writes to the board, so for
// them only a save in flight asks. asOfLabel is the word Refresh wears in a page that carries its board.
// Same dual-environment pattern as ids.js/nesting.js: loaded as a plain <script> in the browser (one global,
// window.kanbanSaveGuard) AND required directly by node --test.

const saveGuardModule = (() => {
  function makeSaveGuard(onChange = () => {}) {
    let inFlight = 0;
    let sent = '';

    function track(promise) {
      inFlight += 1;
      onChange(inFlight);
      const done = () => { inFlight -= 1; onChange(inFlight); };
      promise.then(done, done);
      return promise;
    }

    function leaving(source, fingerprint = '') {
      if (inFlight > 0) return 'saving';
      if (source && source.kind === 'page' && fingerprint !== sent) return 'unsent';
      return null;
    }

    return {
      track,
      leaving,
      inFlight: () => inFlight,
      sent: (fingerprint) => { sent = fingerprint; },
    };
  }

  const pad = (n) => String(n).padStart(2, '0');

  // "Board as of 09:05" in the viewer's local time; the date comes first when the Base is not today.
  function asOfLabel(base, now = new Date()) {
    const at = new Date(base);
    if (!base || Number.isNaN(at.getTime())) return null;
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    return sameDay ? `Board as of ${time}` : `Board as of ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
  }

  return { makeSaveGuard, asOfLabel };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = saveGuardModule;
} else {
  window.kanbanSaveGuard = saveGuardModule;
}
