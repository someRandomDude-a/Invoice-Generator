import { readFile } from 'node:fs/promises';
for (const file of ['packaging/runner.spec', 'packaging/entitlements.mac.plist', 'packaging/LICENSE-LAYA.txt', 'electron-builder.yml', 'backend/desktop.py', 'backend/models.json', 'backend/requirements-build.txt']) {
  try { await readFile(file); }
  catch { throw new Error(`Missing release build input: ${file}. Ensure it is included in the commit/tag being built.`); }
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${version}`) throw new Error(`Release tag ${tag} must match package.json version v${version}.`);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Use a semantic release version.');
console.log(`Building Invoice Studio ${version}`);
