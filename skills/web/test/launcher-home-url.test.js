const { test } = require('node:test');
const assert = require('node:assert');
const launcher = require('../scripts/launcher');

const san = (args, platform = 'win32') => launcher.sanitizeServerArgsForWrapper(args, platform);

test('a home url is re-emitted in = form from its parsed address, after the port and origins', () => {
  assert.deepStrictEqual(
    san(['7801', '--home-url', 'http://127.0.0.1:7791/', '--allow-origin', 'https://t.example.com']),
    ['7801', '--allow-origin=https://t.example.com', '--home-url=http://127.0.0.1:7791/']);
  assert.deepStrictEqual(san(['--home-url=https://shop.example.com/a?b=1'], 'linux'), ['--home-url=https://shop.example.com/a?b=1']);
});

test('a home url that is not http or https is refused', () => {
  assert.throws(() => san(['--home-url', 'javascript:alert(1)']), /home url/);
  assert.throws(() => san(['--home-url=data:text/html,x'], 'linux'), /home url/);
  assert.throws(() => san(['--home-url', 'nonsense']), /home url/);
});

test('a quote or command suffix in a home url is percent-encoded, never a live quote', () => {
  const out = san(['--home-url', 'http://h.example.com/"&echo x>PWNED.txt&"']);
  assert.strictEqual(out.length, 1);
  assert.ok(!/["> \r\n]/.test(out[0]), out[0]);
});

test('a trailing backslash cannot survive into a win32 wrapper', () => {
  const out = san(['--home-url', 'http://h.example.com/a\\']);
  assert.doesNotMatch(out[0], /\\$/);
});

test('anything else is still refused', () => {
  assert.throws(() => san(['7801', '--other']), /unexpected server argument/);
});

test('the cli port is still found with a home url ahead of it', () => {
  assert.strictEqual(launcher.cliPortFromServerArgs(['--home-url', 'http://a/', '7801']), 7801);
  assert.strictEqual(launcher.cliPortFromServerArgs(['--home-url=http://a/', '7801']), 7801);
});
