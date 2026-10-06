const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ORIGIN, resourcePaths, runnerEnvironment, isAppURL, waitForRunner } = require('./runtime.cjs');

test('bundled resources use native executable names', () => {
  assert.ok(resourcePaths('resources', 'win32').runner.endsWith('invoice-runner.exe'));
  assert.ok(resourcePaths('resources', 'linux').runner.endsWith('invoice-runner'));
});
test('immutable bundled weights and writable model downloads are kept separate', () => {
  const env = runnerEnvironment(resourcePaths('resources'), 'user-data', 'secret');
  assert.equal(env.INVOICE_SERVER_TOKEN, 'secret');
  assert.equal(env.INVOICE_PARENT_PID, String(process.pid));
  assert.notEqual(env.INVOICE_MODEL_DIR, env.INVOICE_BUNDLED_MODEL_DIR);
  assert.ok(env.INVOICE_APP_ORIGINS.includes(ORIGIN));
});
test('navigation cannot escape the app origin', () => {
  assert.equal(isAppURL(`${ORIGIN}/`), true);
  for (const url of ['https://example.com', 'file:///secret', 'http://127.0.0.1:17866', 'http://127.0.0.1:17865.evil.example']) assert.equal(isAppURL(url), false);
});
test('runner readiness requires an authenticated healthy response', async () => {
  await waitForRunner({ exitCode: null }, 'secret', { fetchHealth: async (url, options) => {
    assert.equal(url, `${ORIGIN}/health`); assert.equal(options.headers['X-Invoice-Token'], 'secret');
    return { ok: true, json: async () => ({ status: 'ok' }) };
  } });
});
test('failed runner startup stops waiting', async () => {
  await assert.rejects(waitForRunner({ exitCode: 1 }, 'secret'), /stopped during startup/);
});
