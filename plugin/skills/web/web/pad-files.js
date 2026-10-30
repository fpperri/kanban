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

  // A folder as the server names it (a path of the board, with `/` or `\` between names, perhaps a slash at
  // the end) and a file name, joined with one slash.
  function joinFolder(folder, name) {
    const f = String(folder == null ? '' : folder).replace(/[\\/]+$/, '');
    return f === '' ? name : `${f}/${name}`;
  }

  // The absolute path of a file in an absolute folder, with the folder's own separator.
  function absJoin(root, name) {
    const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    return `${root.replace(/[\\/]+$/, '')}${sep}${name}`;
  }

  // Which small picture a row wears.
  function iconOf(entry) {
    if (entry.dir) return 'folder';
    if (entry.page) return 'page';
    if (entry.kind === 'image') return 'image';
    if (entry.kind === 'markdown') return 'markdown';
    if (entry.kind === 'text' || entry.readable) return 'text';
    return 'other';
  }

  // What a row shows on hover: the whole name, then the size (a file) and the date.
  function rowTitle(entry) {
    return [entry.name, entry.dir ? '' : sizeText(entry.size), dateText(entry.mtime)].filter((x) => x !== '').join('\n');
  }

  // Where a file can be moved from the folder shown: its parent, then each subfolder.
  function moveTargets(cwd, entries) {
    const out = [];
    if (cwd !== '') out.push({ label: '.. (up)', path: parentPath(cwd) });
    for (const e of entries) if (e.dir) out.push({ label: `${e.name}/`, path: joinPath(cwd, e.name) });
    return out;
  }

  const moveDest = (destFolder, name) => joinPath(destFolder, name);

  // The path a rename gives a file, or '' when it changes nothing or names a path (that is Move to).
  function renameDest(cwd, oldName, typed) {
    const name = String(typed == null ? '' : typed).trim();
    if (name === '' || name === oldName || /[\\/]/.test(name)) return '';
    return joinPath(cwd, name);
  }

  return { sizeText, dateText, joinPath, parentPath, crumbs, newFileName, joinFolder, absJoin, iconOf, rowTitle, moveTargets, moveDest, renameDest };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = padFilesModule;
} else {
  window.kanbanPadFiles = padFilesModule;
}
