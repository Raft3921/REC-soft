const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('recAPI', {
  platform: process.platform,
  getSources: () => ipcRenderer.invoke('get-sources'),
  ensureCaptureAccess: () => ipcRenderer.invoke('ensure-capture-access'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  beginRecording: (options) => ipcRenderer.invoke('begin-recording', options),
  writeChunk: (arrayBuffer) => ipcRenderer.send('recording-chunk', arrayBuffer),
  finishRecording: () => ipcRenderer.invoke('finish-recording'),
  cancelRecording: () => ipcRenderer.invoke('cancel-recording'),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  askConvertMov: (filePath) => ipcRenderer.invoke('ask-convert-mov', filePath),
  convertToMov: (filePath) => ipcRenderer.invoke('convert-to-mov', filePath),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (callback) => ipcRenderer.on('update-status', (_event, value) => callback(value)),
  onRecovery: (callback) => ipcRenderer.on('recovery-result', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('recording-error', (_event, value) => callback(value))
});
