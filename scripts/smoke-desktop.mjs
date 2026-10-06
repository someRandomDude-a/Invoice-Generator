import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const binaries = {
  win32: 'release/win-unpacked/Invoice Studio.exe',
  darwin: 'release/mac-arm64/Invoice Studio.app/Contents/MacOS/Invoice Studio',
  linux: 'release/linux-unpacked/invoice-studio',
};
const binary = resolve(process.env.INVOICE_DESKTOP_BINARY || binaries[process.platform]);
const userData = await mkdtemp(join(tmpdir(), 'invoice-studio-smoke-'));
const env = { ...process.env, INVOICE_SMOKE_USER_DATA: userData, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
try {
  await new Promise((accept, reject) => {
    const child = spawn(binary, ['--smoke-test'], { env, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Desktop offline smoke test timed out.')); }, 240000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) accept(); else reject(new Error(`Desktop smoke test failed: ${code ?? signal}`));
    });
  });
} catch (error) {
  try { console.error(await readFile(join(userData, 'desktop.log'), 'utf8')); } catch { /* Runner may fail before opening its log. */ }
  throw error;
} finally {
  await rm(userData, { recursive: true, force: true });
}
