const { test } = require('node:test');
const assert = require('node:assert');
const bufferShim = require('../../plugin/skills/web/scripts/buffer-shim');

test('alloc makes zeroed bytes of a length, and isBuffer knows them from plain bytes', () => {
  const b = bufferShim.alloc(4);
  assert.strictEqual(b.length, 4);
  assert.deepStrictEqual([...b], [0, 0, 0, 0]);
  assert.ok(bufferShim.isBuffer(b));
  assert.ok(!bufferShim.isBuffer(new Uint8Array(2)));
});

test('byteLength counts the UTF-8 bytes of a text', () => {
  assert.strictEqual(bufferShim.byteLength('café 😀', 'utf8'), Buffer.byteLength('café 😀', 'utf8'));
});

test('from takes a text, bytes or a list, and toString reads a range back as UTF-8 or hex', () => {
  assert.strictEqual(bufferShim.from('héllo').toString('utf8'), 'héllo');
  assert.strictEqual(bufferShim.from(new Uint8Array([104, 105])).toString(), 'hi');
  assert.strictEqual(bufferShim.from([104, 105, 106]).toString('utf8', 1, 3), 'ij');
  assert.strictEqual(bufferShim.from([1, 171]).toString('hex'), '01ab');
});

test('subarray and includes work on it as on a Node buffer', () => {
  const b = bufferShim.from([0, 1, 2, 3]);
  assert.ok(b.includes(0));
  assert.ok(!b.subarray(1).includes(0));
  assert.ok(bufferShim.isBuffer(b.subarray(1)));
});
