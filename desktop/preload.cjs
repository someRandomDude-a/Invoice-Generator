const { contextBridge } = require('electron');
// Sandboxed preload scripts cannot require local modules.
const origin = process.argv.find(value => value.startsWith('--invoice-runner-origin='))?.split('=')[1];
contextBridge.exposeInMainWorld('invoiceDesktop', Object.freeze({ runnerEndpoint: origin }));
