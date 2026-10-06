const { join } = require('node:path');

const PORT = 17865;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function resourcePaths(root, platform = process.platform) {
  return {
    runner: join(root, 'runner', platform === 'win32' ? 'invoice-runner.exe' : 'invoice-runner'),
    models: join(root, 'models'),
    ui: join(root, 'ui'),
  };
}

function runnerEnvironment(paths, userData, token) {
  return {
    ...process.env,
    INVOICE_SERVER_PORT: String(PORT),
    INVOICE_SERVER_TOKEN: token,
    INVOICE_PARENT_PID: String(process.pid),
    INVOICE_MODEL_DIR: join(userData, 'models'),
    INVOICE_BUNDLED_MODEL_DIR: paths.models,
    INVOICE_UI_DIR: paths.ui,
    INVOICE_APP_ORIGINS: [ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'].join(','),
    HF_HOME: join(userData, 'huggingface'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    USE_TF: '0',
    PYTHONNOUSERSITE: '1',
  };
}

function isAppURL(url, origin = ORIGIN) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

async function waitForRunner(child, token, { timeout = 90000, fetchHealth = fetch } = {}) {
  const end = Date.now() + timeout;
  let lastError = 'No health response';
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode) throw new Error('The bundled model runner stopped during startup.');
    try {
      const response = await fetchHealth(`${ORIGIN}/health`, {
        headers: { 'X-Invoice-Token': token }, signal: AbortSignal.timeout(2000),
      });
      if (response.ok && (await response.json()).status === 'ok') return;
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error.message; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`The model runner health check timed out (${lastError}). Port ${PORT} may already be in use. See desktop.log in the app data folder.`);
}

module.exports = { ORIGIN, PORT, resourcePaths, runnerEnvironment, isAppURL, waitForRunner };
