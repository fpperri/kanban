'use strict';
// The `path` calls the stores use, as POSIX path does them, for a place that has no Node. A relative
// path resolves from the root. Same dual-environment pattern as ids.js: required by node --test, and
// loaded as a plain <script> (one global, window.kanbanPosixPath).

const posixPathModule = (() => {
  // The segments of `p` with `.` dropped and `..` taken, as a list; an absolute path never climbs above the root.
  function segmentsOf(p, absolute) {
    const out = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else if (!absolute) out.push('..');
      } else out.push(seg);
    }
    return out;
  }

  const isAbsolute = (p) => p.charAt(0) === '/';

  function normalize(p) {
    if (p === '') return '.';
    const abs = isAbsolute(p);
    const body = segmentsOf(p, abs).join('/');
    const trailing = p.charAt(p.length - 1) === '/';
    if (abs) return `/${body}${body && trailing ? '/' : ''}`;
    if (body === '') return trailing ? './' : '.';
    return trailing ? `${body}/` : body;
  }

  function join(...parts) {
    const kept = parts.filter((p) => p !== '');
    return kept.length ? normalize(kept.join('/')) : '.';
  }

  function resolve(...parts) {
    let resolved = '';
    for (let i = parts.length - 1; i >= 0 && !isAbsolute(resolved); i--) {
      if (parts[i] !== '') resolved = resolved === '' ? parts[i] : `${parts[i]}/${resolved}`;
    }
    return `/${segmentsOf(resolved, true).join('/')}`;
  }

  function trimmed(p) {
    let end = p.length;
    while (end > 1 && p.charAt(end - 1) === '/') end--;
    return p.slice(0, end);
  }

  function dirname(p) {
    if (p === '') return '.';
    const t = trimmed(p);
    const cut = t.lastIndexOf('/');
    if (cut === -1) return '.';
    if (cut === 0) return '/';
    return trimmed(t.slice(0, cut));
  }

  function basename(p, ext) {
    const t = trimmed(p);
    const name = t === '/' ? '' : t.slice(t.lastIndexOf('/') + 1);
    return ext && name !== ext && name.endsWith(ext) ? name.slice(0, name.length - ext.length) : name;
  }

  function extname(p) {
    const name = basename(p);
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || name === '..') return '';
    return name.slice(dot);
  }

  function relative(from, to) {
    const a = segmentsOf(resolve(from), true);
    const b = segmentsOf(resolve(to), true);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  }

  const api = { sep: '/', normalize, join, resolve, dirname, basename, extname, relative, isAbsolute };
  api.posix = api;
  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = posixPathModule;
} else {
  window.kanbanPosixPath = posixPathModule;
}
