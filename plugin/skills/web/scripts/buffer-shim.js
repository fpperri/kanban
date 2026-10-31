'use strict';
// The few Buffer calls the stores make, for a page that has no Node's Buffer: alloc, byteLength, from
// and isBuffer on the class, and toString (UTF-8 or hex, over a range), includes and subarray on its
// bytes. It is the `Buffer` the module loader gives the stores in the page; nothing else about Node's
// Buffer is here, so a store that needs more adds it here with the test that holds it to Node's answer.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanBufferShim).

const bufferShimModule = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  class ShimBuffer extends Uint8Array {
    toString(encoding = 'utf8', start = 0, end = this.length) {
      const part = this.subarray(start, end);
      if (encoding === 'hex') return Array.from(part, (b) => b.toString(16).padStart(2, '0')).join('');
      if (!/^utf-?8$/i.test(encoding)) throw new Error(`the Buffer shim prints utf8 and hex only, not ${encoding}`);
      return decoder.decode(part);
    }

    static alloc(n) { return new ShimBuffer(n); }

    static byteLength(text) { return encoder.encode(String(text)).length; }

    static from(source) {
      const bytes = typeof source === 'string' ? encoder.encode(source) : Uint8Array.from(source);
      return new ShimBuffer(bytes.buffer, bytes.byteOffset, bytes.length);
    }

    static isBuffer(value) { return value instanceof ShimBuffer; }
  }

  return ShimBuffer;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = bufferShimModule;
} else {
  window.kanbanBufferShim = bufferShimModule;
}
