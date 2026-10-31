'use strict';
// A file system held in memory, for a place that has no Node: makeMemoryFs(files) gives the synchronous
// `fs` calls the stores make and nothing else (read, write, append, rename, list, make a folder,
// unlink, stat, exists, realpath, and open, read and close). It answers as a POSIX file system does,
// with Node's error codes on the same mistakes, so a store's catch reads the same either way. `files`
// maps an absolute path to its text or bytes; its folders are made as needed. Text is UTF-8. A byte
// answer is a Buffer when there is one (`options.Buffer`, else the global; null for none) and a Uint8Array otherwise.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanMemoryFs).

const memoryFsModule = (() => {
  const posixPath = typeof module !== 'undefined' && module.exports ? require('./posix-path') : window.kanbanPosixPath;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  function fail(code, syscall, p, message) {
    const err = new Error(`${code}: ${message}, ${syscall} '${p}'`);
    err.code = code;
    err.syscall = syscall;
    err.path = p;
    return err;
  }

  function makeMemoryFs(files = {}, options = {}) {
    const clock = options.now || (() => Date.now());
    const nodes = new Map(); // absolute path -> { dir, data, ino, mtimeMs }
    const fds = new Map();
    let nextIno = 1;
    let nextFd = 3;

    const touch = (node) => { node.mtimeMs = clock(); };
    const make = (dir, data) => { const node = { dir, data, ino: nextIno++ }; touch(node); return node; };
    nodes.set('/', make(true));

    const abs = (p) => posixPath.resolve(String(p));
    const bytesOf = (data) => (typeof data === 'string' ? encoder.encode(data) : Uint8Array.from(data));
    const toBuffer = (u8) => {
      const B = 'Buffer' in options ? options.Buffer : (typeof Buffer !== 'undefined' ? Buffer : null);
      return B ? B.from(u8) : u8.slice();
    };
    const encodingOf = (opts) => (typeof opts === 'string' ? opts : (opts && opts.encoding) || null);
    const checkEncoding = (enc, syscall, p) => {
      if (enc !== null && !/^utf-?8$/i.test(enc)) throw fail('ERR_UNSUPPORTED_ENCODING', syscall, p, `the memory file system reads utf8 only, not ${enc}`);
    };

    // A path's node, or the error Node gives for what is in the way.
    function lookup(p, syscall) {
      const a = abs(p);
      const node = nodes.get(a);
      if (node) return { a, node };
      for (let up = posixPath.dirname(a); up !== '/'; up = posixPath.dirname(up)) {
        const parent = nodes.get(up);
        if (parent && !parent.dir) throw fail('ENOTDIR', syscall, p, 'not a directory');
      }
      throw fail('ENOENT', syscall, p, 'no such file or directory');
    }

    // The folder a new entry goes in must be there.
    function parentOf(a, p, syscall) {
      const parent = nodes.get(posixPath.dirname(a));
      if (!parent) throw fail('ENOENT', syscall, p, 'no such file or directory');
      if (!parent.dir) throw fail('ENOTDIR', syscall, p, 'not a directory');
    }

    function mkdirAll(a, p) {
      if (nodes.has(a)) return;
      const up = posixPath.dirname(a);
      mkdirAll(up, p);
      if (!nodes.get(up).dir) throw fail('ENOTDIR', 'mkdir', p, 'not a directory');
      nodes.set(a, make(true));
    }

    function statsOf(node, opts) {
      const big = !!(opts && opts.bigint);
      const num = (n) => (big ? BigInt(Math.trunc(n)) : n);
      const mtimeMs = node.mtimeMs;
      return {
        isFile: () => !node.dir,
        isDirectory: () => node.dir,
        isSymbolicLink: () => false,
        size: num(node.dir ? 0 : node.data.length),
        dev: num(1),
        ino: num(node.ino),
        mode: num(node.dir ? 0o40755 : 0o100644),
        nlink: num(1),
        mtimeMs: num(mtimeMs),
        mtime: new Date(mtimeMs),
        ctimeMs: num(mtimeMs),
        ctime: new Date(mtimeMs),
        birthtime: new Date(mtimeMs),
      };
    }

    const memory = {
      existsSync(p) {
        try { return nodes.has(abs(p)); } catch (_) { return false; }
      },

      statSync(p, opts) {
        return statsOf(lookup(p, 'stat').node, opts);
      },

      lstatSync(p, opts) {
        return statsOf(lookup(p, 'lstat').node, opts);
      },

      realpathSync(p) {
        return lookup(p, 'realpath').a;
      },

      readFileSync(p, opts) {
        const enc = encodingOf(opts);
        checkEncoding(enc, 'open', p);
        const { node } = lookup(p, 'open');
        if (node.dir) throw fail('EISDIR', 'read', p, 'illegal operation on a directory');
        return enc === null ? toBuffer(node.data) : decoder.decode(node.data);
      },

      writeFileSync(p, data, opts) {
        checkEncoding(encodingOf(opts), 'open', p);
        const a = abs(p);
        const existing = nodes.get(a);
        if (existing && opts && typeof opts === 'object' && opts.flag === 'wx') throw fail('EEXIST', 'open', p, 'file already exists');
        if (existing && existing.dir) throw fail('EISDIR', 'open', p, 'illegal operation on a directory');
        if (!existing) parentOf(a, p, 'open');
        const bytes = bytesOf(data);
        if (existing) { existing.data = bytes; touch(existing); } else { nodes.set(a, make(false, bytes)); }
      },

      appendFileSync(p, data) {
        const existing = nodes.get(abs(p));
        if (existing && existing.dir) throw fail('EISDIR', 'open', p, 'illegal operation on a directory');
        if (!existing) { memory.writeFileSync(p, data); return; }
        const add = bytesOf(data);
        const joined = new Uint8Array(existing.data.length + add.length);
        joined.set(existing.data);
        joined.set(add, existing.data.length);
        existing.data = joined;
        touch(existing);
      },

      mkdirSync(p, opts) {
        const a = abs(p);
        if (opts && opts.recursive) {
          const existing = nodes.get(a);
          if (existing && !existing.dir) throw fail('EEXIST', 'mkdir', p, 'file already exists');
          if (existing) return undefined;
          let first = a;
          while (!nodes.has(posixPath.dirname(first))) first = posixPath.dirname(first);
          mkdirAll(a, p);
          return first;
        }
        if (nodes.has(a)) throw fail('EEXIST', 'mkdir', p, 'file already exists');
        parentOf(a, p, 'mkdir');
        nodes.set(a, make(true));
        return undefined;
      },

      readdirSync(p, opts) {
        const { a, node } = lookup(p, 'scandir');
        if (!node.dir) throw fail('ENOTDIR', 'scandir', p, 'not a directory');
        const names = [];
        for (const other of nodes.keys()) {
          if (other !== a && posixPath.dirname(other) === a) names.push(posixPath.basename(other));
        }
        names.sort();
        if (!(opts && opts.withFileTypes)) return names;
        return names.map((name) => {
          const child = nodes.get(posixPath.join(a, name));
          return { name, parentPath: a, path: a, isFile: () => !child.dir, isDirectory: () => child.dir, isSymbolicLink: () => false };
        });
      },

      renameSync(from, to) {
        const { a: source, node } = lookup(from, 'rename');
        const dest = abs(to);
        if (source === dest) return;
        if (node.dir && dest.startsWith(`${source}/`)) throw fail('EINVAL', 'rename', from, 'invalid argument');
        const there = nodes.get(dest);
        if (!there) parentOf(dest, to, 'rename');
        if (there) {
          if (there.dir && !node.dir) throw fail('EISDIR', 'rename', from, 'illegal operation on a directory');
          if (!there.dir && node.dir) throw fail('ENOTDIR', 'rename', from, 'not a directory');
          if (there.dir && [...nodes.keys()].some((k) => k.startsWith(`${dest}/`))) throw fail('ENOTEMPTY', 'rename', from, 'directory not empty');
        }
        const moving = [...nodes.keys()].filter((k) => k === source || k.startsWith(`${source}/`));
        const carried = moving.map((k) => [dest + k.slice(source.length), nodes.get(k)]);
        for (const k of moving) nodes.delete(k);
        nodes.delete(dest);
        for (const [k, n] of carried) nodes.set(k, n);
      },

      unlinkSync(p) {
        const { a, node } = lookup(p, 'unlink');
        if (node.dir) throw fail('EISDIR', 'unlink', p, 'illegal operation on a directory');
        nodes.delete(a);
      },

      openSync(p, flags = 'r') {
        if (flags !== 'r') throw fail('ERR_UNSUPPORTED_FLAG', 'open', p, 'the memory file system opens to read only');
        const { node } = lookup(p, 'open');
        if (node.dir) throw fail('EISDIR', 'read', p, 'illegal operation on a directory');
        const fd = nextFd++;
        fds.set(fd, node);
        return fd;
      },

      readSync(fd, buffer, offset, length, position) {
        const node = fds.get(fd);
        if (!node) throw fail('EBADF', 'read', String(fd), 'bad file descriptor');
        const from = position === null || position === undefined ? 0 : position;
        const slice = node.data.subarray(from, from + length);
        buffer.set(slice, offset);
        return slice.length;
      },

      closeSync(fd) {
        if (!fds.delete(fd)) throw fail('EBADF', 'close', String(fd), 'bad file descriptor');
      },

      // The whole tree as { path: bytes }, a folder as a path ending in `/` holding null: for a test to compare.
      dump() {
        const out = {};
        for (const [k, n] of [...nodes.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
          if (k !== '/') out[n.dir ? `${k}/` : k] = n.dir ? null : n.data;
        }
        return out;
      },
    };
    memory.realpathSync.native = memory.realpathSync;

    for (const [p, data] of Object.entries(files)) {
      mkdirAll(posixPath.dirname(abs(p)), p);
      nodes.set(abs(p), make(false, bytesOf(data)));
    }
    return memory;
  }

  return { makeMemoryFs };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = memoryFsModule;
} else {
  window.kanbanMemoryFs = memoryFsModule;
}
