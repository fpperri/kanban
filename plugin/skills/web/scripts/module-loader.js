'use strict';
// A small CommonJS loader, for a place that has no Node's require: makeLoader({ sources, builtins })
// runs the modules named by `sources` (a path to its source text) and resolves their relative requires
// against those paths, with or without `.js` or `/index.js`. A Node built-in a module requires (`fs`,
// `path`, `crypto`) comes from `builtins`, by name, with or without `node:`; one that is not there is
// an error that names it, so a store that starts needing a new built-in fails the first time it is
// loaded until a shim is given for it. A module also sees `process` and `Buffer` as parameters:
// `globals` overrides them, and the default `process` says it runs on a POSIX system from the root.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanModuleLoader).

const moduleLoaderModule = (() => {
  const posix = typeof module !== 'undefined' && module.exports ? require('./posix-path') : window.kanbanPosixPath;

  const defaultProcess = () => ({ platform: 'linux', pid: 1, env: {}, cwd: () => '/' });

  function makeLoader({ sources, builtins = {}, globals = {} }) {
    const cache = new Map();
    const sandbox = {
      process: 'process' in globals ? globals.process : defaultProcess(),
      Buffer: 'Buffer' in globals ? globals.Buffer : (typeof Buffer !== 'undefined' ? Buffer : undefined),
    };

    function resolve(from, request) {
      const base = posix.join(posix.dirname(from), request);
      for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
        if (Object.prototype.hasOwnProperty.call(sources, candidate)) return candidate;
      }
      throw new Error(`Cannot find module '${request}' from '${from}'`);
    }

    function load(file) {
      if (cache.has(file)) return cache.get(file).exports;
      if (!Object.prototype.hasOwnProperty.call(sources, file)) throw new Error(`Cannot find module '${file}'`);
      const mod = { exports: {} };
      cache.set(file, mod); // set before it runs, so a require cycle sees the exports so far
      const require = (request) => {
        if (request.startsWith('.')) return load(resolve(file, request));
        const name = request.replace(/^node:/, '');
        if (!Object.prototype.hasOwnProperty.call(builtins, name)) throw new Error(`The module loader has no shim for the Node built-in '${request}' (required by '${file}')`);
        return builtins[name];
      };
      const run = new Function('exports', 'require', 'module', '__filename', '__dirname', 'process', 'Buffer', `${sources[file]}\n//# sourceURL=${file}`);
      try {
        run.call(mod.exports, mod.exports, require, mod, file, posix.dirname(file), sandbox.process, sandbox.Buffer);
      } catch (err) {
        cache.delete(file);
        throw err;
      }
      return mod.exports;
    }

    return { load };
  }

  return { makeLoader };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = moduleLoaderModule;
} else {
  window.kanbanModuleLoader = moduleLoaderModule;
}
