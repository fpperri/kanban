'use strict';
// The pure parts of the Scratchpad tab's folder browser (scratchpad-folder-ui.js): how a size and a date
// read, how paths of the card's folder are joined and walked back up, and the name a typed new file gets.
// Paths here are the server's: relative to the card's folder, `/` between names, '' for the folder itself.
// Same dual-environment pattern as ids.js: loaded as a plain <script> in the browser (one global,
// window.kanbanPadFiles) AND required directly by node --test.

const padFilesModule = (() => {
  // 5 B, 1.5 KB, 2.0 MB: one decimal from the kilobyte up.
  function sizeText(bytes) {
    const n = Number(bytes);
    if (!(n >= 0)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // An ISO moment as the local `YYYY-MM-DD HH:MM`; '' for anything else.
  function dateText(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
  }

  const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);

  const parentPath = (rel) => (rel === '' ? null : rel.split('/').slice(0, -1).join('/'));

  // The folder you walk through to reach `rel`: [{ name: '', path: '' }, { name: 'a', path: 'a' }, ...].
  function crumbs(rel) {
    const out = [{ name: '', path: '' }];
    let so = '';
    for (const name of rel === '' ? [] : rel.split('/')) {
      so = joinPath(so, name);
      out.push({ name, path: so });
    }
    return out;
  }

  // What a typed new file name becomes: trimmed, and `.md` when it does not already end in .md or .txt.
  // A blank stays blank.
  function newFileName(typed) {
    const name = String(typed == null ? '' : typed).trim();
    if (name === '') return '';
    return /\.(md|txt)$/i.test(name) ? name : `${name}.md`;
  }

  return { sizeText, dateText, joinPath, parentPath, crumbs, newFileName };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = padFilesModule;
} else {
  window.kanbanPadFiles = padFilesModule;
}
