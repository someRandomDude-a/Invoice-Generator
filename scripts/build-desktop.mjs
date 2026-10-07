import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function builderEnvironment(environment) {
  const env = { ...environment };
  // GitHub supplies absent optional secrets as empty strings. electron-builder's
  // macOS certificate loader treats an empty CSC_LINK as the current directory.
  for (const key of ['CSC_LINK', 'WIN_CSC_LINK']) {
    if (typeof env[key] === 'string' && !env[key].trim()) delete env[key];
  }
  // Keep real certificates and passwords unchanged; invalid signing must still fail.
  return env;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), ...process.argv.slice(2)], {
    env: builderEnvironment(process.env), stdio: 'inherit',
  });
  process.exitCode = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', code => accept(code ?? 1));
  });
}
