import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checksumAssets(directory) {
  const names = (await readdir(directory)).filter(name => /\.(exe|zip|dmg|AppImage|deb)$/.test(name)).sort();
  if (!names.length) throw new Error('No desktop release artifacts were produced.');
  const lines = [];
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path);
    // GitHub release uploads have a per-file limit; never silently publish incomplete builds.
    if (!info.isFile() || info.size >= 2 * 1024 ** 3) throw new Error(`${name} exceeds the 2 GiB release asset limit.`);
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  return names;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await checksumAssets(resolve(process.argv[2] || 'release')));
}
