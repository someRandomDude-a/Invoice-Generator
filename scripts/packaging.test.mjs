import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checksumAssets } from './checksums.mjs';
import { verifyInputs } from './stage-desktop.mjs';

test('native build recipe exists and is not excluded from Git', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  await readFile(join(root, 'packaging/runner.spec'), 'utf8');
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', 'packaging/runner.spec'], { cwd: root });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, 'packaging/runner.spec must not be ignored: clean CI checkouts need this build recipe');
});

test('release checksums cover deliverables, not unpacked directories', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'invoice-checksums-'));
  try {
    await writeFile(join(temp, 'app.zip'), 'test');
    await mkdir(join(temp, 'win-unpacked'));
    assert.deepEqual(await checksumAssets(temp), ['app.zip']);
    assert.match(await readFile(join(temp, 'SHA256SUMS.txt'), 'utf8'), /^9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08  app.zip\n$/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('packaging refuses to ship without the default weights', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'invoice-package-'));
  try { await assert.rejects(verifyInputs(temp), /ENOENT/); }
  finally { await rm(temp, { recursive: true, force: true }); }
});
test('packaging rejects a changed revision or a checkpoint outside the bundled cache', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'invoice-registry-'));
  try {
    await mkdir(join(temp, 'backend'));
    await mkdir(join(temp, '.packaging/models'), { recursive: true });
    const preset = { adapter: 'laya', repo_id: 'owner/model', revision: 'abc123' };
    await writeFile(join(temp, 'backend/models.json'), JSON.stringify({ presets: [preset] }));
    const registry = { 'laya:owner/model@abc123': { resolved_revision: 'changed', path: 'cache/checkpoint' } };
    const path = join(temp, '.packaging/models/registry.json');
    await writeFile(path, JSON.stringify(registry));
    await assert.rejects(verifyInputs(temp), /pinned default/);
    registry['laya:owner/model@abc123'] = { resolved_revision: 'abc123', path: '../outside' };
    await writeFile(path, JSON.stringify(registry));
    await assert.rejects(verifyInputs(temp), /escapes/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
