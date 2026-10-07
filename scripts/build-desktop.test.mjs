import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { builderEnvironment } from './build-desktop.mjs';

test('absent signing secrets are omitted instead of becoming certificate paths', () => {
  const input = { CSC_LINK: '', WIN_CSC_LINK: ' \t ', CSC_IDENTITY_AUTO_DISCOVERY: 'false', PATH: 'tools' };
  const env = builderEnvironment(input);
  assert.equal(Object.hasOwn(env, 'CSC_LINK'), false);
  assert.equal(Object.hasOwn(env, 'WIN_CSC_LINK'), false);
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  assert.equal(env.PATH, 'tools');
  assert.equal(input.CSC_LINK, '');
});

test('configured signing and notarization credentials remain unchanged', () => {
  const env = { CSC_LINK: '/certificates/developer.p12', WIN_CSC_LINK: 'base64-certificate',
    CSC_KEY_PASSWORD: ' password ', APPLE_ID: 'account@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'secret', APPLE_TEAM_ID: 'team' };
  assert.deepEqual(builderEnvironment(env), env);
  assert.deepEqual(builderEnvironment({ CSC_LINK: 'invalid-certificate', CSC_KEY_PASSWORD: '' }), {
    CSC_LINK: 'invalid-certificate', CSC_KEY_PASSWORD: '',
  });
  assert.deepEqual(builderEnvironment({}), {});
});

test('wrapper launches the installed builder CLI and propagates failures', () => {
  const script = fileURLToPath(new URL('./build-desktop.mjs', import.meta.url));
  const options = { env: { ...process.env, CSC_LINK: '', WIN_CSC_LINK: '' }, encoding: 'utf8', timeout: 30000 };
  const help = spawnSync(process.execPath, [script, '--help'], options);
  assert.equal(help.error, undefined);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /publish/);
  const invalid = spawnSync(process.execPath, [script, '--not-a-builder-option'], options);
  assert.equal(invalid.error, undefined);
  assert.notEqual(invalid.status, 0);
});
