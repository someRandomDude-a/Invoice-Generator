const { app, BrowserWindow, dialog, session, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createWriteStream, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { ORIGIN, resourcePaths, runnerEnvironment, isAppURL, waitForRunner } = require('./runtime.cjs');

let runner;
let window;
let log;
let stopping = false;
const smokeTest = process.argv.includes('--smoke-test');
const devOrigin = !app.isPackaged && process.argv.includes('--dev') ? 'http://127.0.0.1:5173' : ORIGIN;
app.setName('Invoice Studio');
if (smokeTest && !process.env.INVOICE_SMOKE_USER_DATA) throw new Error('Smoke tests require a temporary INVOICE_SMOKE_USER_DATA directory.');
const userDataPath = smokeTest ? process.env.INVOICE_SMOKE_USER_DATA : join(app.getPath('appData'), 'Invoice Studio');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

async function stopRunner() {
  if (!runner || runner.exitCode !== null || runner.signalCode) return;
  const child = runner;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
    timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function start() {
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  log = createWriteStream(join(userData, 'desktop.log'), { flags: 'a' });
  const resources = resourcePaths(app.isPackaged ? process.resourcesPath : join(__dirname, '..', '.packaging', 'resources'));
  const token = randomBytes(32).toString('hex');
  runner = spawn(resources.runner, [], {
    env: runnerEnvironment(resources, userData, token), cwd: userData,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  runner.stdout.pipe(log, { end: false }); runner.stderr.pipe(log, { end: false });
  runner.on('error', error => log.write(`${error.message}\n`));
  runner.on('exit', () => {
    if (!stopping) {
      if (!smokeTest) dialog.showErrorBox('Model runner stopped', 'Restart the app. Details are saved in desktop.log in your app data folder.');
      app.exit(1);
    }
  });
  await Promise.race([waitForRunner(runner, token), new Promise((_resolve, reject) => runner.once('error', reject))]);
  // Authenticate only our loopback server. The token is never exposed to renderer JavaScript.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${ORIGIN}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'X-Invoice-Token': token } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  const createWindow = async () => {
    window = new BrowserWindow({
      width: 1280, height: 850, minWidth: 760, minHeight: 560, show: !smokeTest,
      backgroundColor: '#10121b', title: 'Invoice Studio',
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        additionalArguments: [`--invoice-runner-origin=${ORIGIN}`] },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url, devOrigin)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning', buttons: ['Stay', 'Discard changes'], defaultId: 0, cancelId: 0,
        message: 'Leave without saving?', detail: 'Unsaved edits and import review rows will be lost.',
      });
      if (choice === 1) event.preventDefault();
    });
    window.on('closed', () => { window = undefined; });
    await window.loadURL(devOrigin);
  };
  await createWindow();
  if (smokeTest) {
    // Test the actual packaged app, UI, authenticated API and bundled offline CPU checkpoint.
    const result = await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 10000;
      while (!document.querySelector('#root h1') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (!document.querySelector('#root h1') || !window.invoiceDesktop?.runnerEndpoint) throw new Error('Desktop UI/preload failed');
      const response = await fetch('/models'); if (!response.ok) throw new Error('Desktop API authentication failed');
      const models = await response.json();
      const model = models.downloaded.find(m => m.repo_id === models.presets[0].repo_id && m.revision === models.presets[0].revision);
      if (!model) throw new Error('Bundled Laya checkpoint is missing');
      const extract = await fetch('/extract', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        ...model, text:'Customer: Alice', device:'cpu', fields:[{column:'customer_name', terms:'customer'}], confidence_threshold:0
      }) });
      const data = await extract.json(); if (!extract.ok || data.device !== 'cpu' || data.values?.customer_name !== 'Alice') throw new Error(JSON.stringify(data));
      return { device:data.device, model:data.model };
    })()`);
    console.log(`Desktop smoke test passed: ${JSON.stringify(result)}`);
    app.quit();
  } else {
    app.on('activate', () => { if (!window) void createWindow().catch(fail); });
  }
}

async function fail(error) {
  stopping = true;
  console.error(error);
  if (!smokeTest) dialog.showErrorBox('Could not start Invoice Studio', error.message);
  await stopRunner();
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  // Do not kill the runner until windows close; a user may cancel an unsaved-data prompt.
  app.on('will-quit', event => {
    if (stopping) return;
    event.preventDefault(); stopping = true;
    void stopRunner().finally(() => { log?.end(); app.quit(); });
  });
  app.whenReady().then(start).catch(fail);
}
