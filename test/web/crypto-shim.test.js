const { test } = require('node:test');
const assert = require('node:assert');
const nodeCrypto = require('node:crypto');
const shim = require('../../plugin/skills/web/scripts/crypto-shim');
const { versionOf } = require('../../plugin/skills/web/scripts/store-common');

const TEXTS = [
  '',
  'a',
  'abc',
  '- [ ] a\n- [x] b\n',
  'x'.repeat(55),
  'x'.repeat(56),
  'x'.repeat(63),
  'x'.repeat(64),
  'x'.repeat(65),
  'y'.repeat(1000),
  'caf\u00e9 \u2713 \ud83d\ude00 \u4e2d\u6587',
  'line\r\nbreak\r\n',
];

test('the sha256 shim gives the digest Node gives, for text of every block-edge length and for non-ASCII text', () => {
  for (const t of TEXTS) {
    assert.strictEqual(shim.createHash('sha256').update(t).digest('hex'), nodeCrypto.createHash('sha256').update(t).digest('hex'), JSON.stringify(t.slice(0, 20)));
  }
});

test('the sha256 shim takes bytes, and several updates join into one digest', () => {
  const bytes = Buffer.from([0, 1, 2, 250, 255]);
  assert.strictEqual(shim.createHash('sha256').update(bytes).digest('hex'), nodeCrypto.createHash('sha256').update(bytes).digest('hex'));
  assert.strictEqual(shim.createHash('sha256').update('ab').update('c').digest('hex'), nodeCrypto.createHash('sha256').update('abc').digest('hex'));
});

test('the file version is the same 16 characters whether the store hashes with Node or the shim', () => {
  for (const t of TEXTS) {
    const viaShim = shim.createHash('sha256').update(t).digest('hex').slice(0, 16);
    assert.strictEqual(viaShim, versionOf(t));
    assert.match(viaShim, /^[0-9a-f]{16}$/);
  }
});

test('the shim hashes sha256 only and says so for any other algorithm', () => {
  assert.throws(() => shim.createHash('md5'), /sha256/);
});

test('randomBytes gives n bytes that print as 2n hex characters and differ between calls', () => {
  const a = shim.randomBytes(6);
  const b = shim.randomBytes(6);
  assert.strictEqual(a.length, 6);
  assert.match(a.toString('hex'), /^[0-9a-f]{12}$/);
  assert.notStrictEqual(a.toString('hex'), b.toString('hex'));
});
