const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, powerSaveBlocker, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

app.enableSandbox();

let win;
let recording = null;
let blockerId = null;
let sourceCache = new Map();
const send = (channel, value) => win && !win.isDestroyed() && win.webContents.send(channel, value);
const isTrusted = (event) => event.sender === win?.webContents && event.senderFrame?.url.startsWith('file:');

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 760, minWidth: 760, minHeight: 680, show: false, autoHideMenuBar: true,
    backgroundColor: '#090b10', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (!recording) return;
    event.preventDefault();
    dialog.showMessageBox(win, { type: 'warning', title: '録画中です', message: '録画を停止して保存してから終了してください。', buttons: ['録画に戻る'] });
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let response = {};
    try {
      let selected = sourceCache.get(recording?.sourceId);
      if (!selected && sourceCache.size === 0) {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        sourceCache = new Map(sources.map((source) => [source.id, source]));
        selected = sources[0];
      }
      if (selected) response = { video: selected, audio: ['win32', 'darwin'].includes(process.platform) ? 'loopback' : undefined };
    } catch (error) { send('recording-error', error.message); }
    callback(response);
  }, { useSystemPicker: process.platform === 'darwin' });
}

function ffmpegPath() {
  const bundled = require('ffmpeg-static');
  return app.isPackaged ? bundled.replace('app.asar', 'app.asar.unpacked') : bundled;
}

function uniquePath(directory, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = path.join(directory, `REC-${stamp}.${extension}`);
  let index = 2;
  while (fs.existsSync(candidate)) candidate = path.join(directory, `REC-${stamp}-${index++}.${extension}`);
  return candidate;
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return typeof value.outputDir === 'string' && path.isAbsolute(value.outputDir) ? value : {};
  } catch { return {}; }
}
function saveSettings(value) {
  const target = settingsPath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function recoverInterruptedRecording() {
  const directory = path.join(app.getPath('userData'), 'Recovery');
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.webm.part')).sort().reverse();
  if (!files.length) return;
  const answer = await dialog.showMessageBox(win, {
    type: 'warning', title: '未完了の録画を検出', message: '前回の録画を復旧しますか？',
    detail: '異常終了前までの映像をMKVとして復旧します。元データは成功するまで保持されます。',
    buttons: ['録画を復旧', 'あとで'], defaultId: 0, cancelId: 1, noLink: true
  });
  if (answer.response !== 0) return;
  const input = path.join(directory, files[0]);
  const output = uniquePath(app.getPath('videos'), 'recovered.mkv');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath(), ['-y', '-i', input, '-map', '0', '-c', 'copy', output], { windowsHide: true });
      let errorText = '';
      child.stderr.on('data', (data) => { errorText += data.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errorText.slice(-700))));
    });
    fs.rmSync(input, { force: true });
    send('recovery-result', { ok: true, path: output });
  } catch (error) {
    send('recovery-result', { ok: false, message: error.message });
  }
}

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
  sourceCache = new Map(sources.map((source) => [source.id, source]));
  return sources.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
});
ipcMain.handle('ensure-capture-access', async (event) => {
  if (!isTrusted(event) || process.platform !== 'darwin') return false;
  for (const kind of ['camera', 'microphone']) {
    if (systemPreferences.getMediaAccessStatus(kind) === 'not-determined') await systemPreferences.askForMediaAccess(kind);
  }
  return systemPreferences.getMediaAccessStatus('camera') === 'granted';
});
ipcMain.handle('get-settings', (event) => {
  if (!isTrusted(event)) throw new Error('許可されていない操作です');
  const saved = readSettings().outputDir;
  return { outputDir: saved && fs.existsSync(saved) ? saved : app.getPath('videos') };
});
ipcMain.handle('choose-folder', async (event) => {
  if (!isTrusted(event)) throw new Error('許可されていない操作です');
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  const outputDir = result.filePaths[0];
  saveSettings({ outputDir });
  return outputDir;
});
ipcMain.handle('begin-recording', async (_event, options) => {
  if (!isTrusted(_event)) throw new Error('許可されていない操作です');
  if (recording) throw new Error('すでに録画中です');
  const outputDir = options.outputDir || app.getPath('videos');
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new Error('保存先が正しくありません');
  fs.mkdirSync(outputDir, { recursive: true });
  const recoveryDir = path.join(app.getPath('userData'), 'Recovery');
  fs.mkdirSync(recoveryDir, { recursive: true });
  const tempPath = uniquePath(recoveryDir, 'webm.part');
  recording = { sourceId: options.sourceId, tempPath, finalPath: uniquePath(outputDir, 'mkv'), stream: fs.createWriteStream(tempPath, { highWaterMark: 8 * 1024 * 1024 }) };
  recording.stream.on('error', (error) => send('recording-error', `保存先への書き込みに失敗しました: ${error.message}`));
  blockerId = powerSaveBlocker.start('prevent-display-sleep');
  return { finalPath: recording.finalPath };
});
ipcMain.on('recording-chunk', (event, arrayBuffer) => {
  if (!isTrusted(event) || !recording || !(arrayBuffer instanceof ArrayBuffer)) return;
  if (!recording.stream.write(Buffer.from(arrayBuffer))) event.sender.send('recording-backpressure', true);
});
ipcMain.handle('finish-recording', async (event) => {
  if (!isTrusted(event)) throw new Error('許可されていない操作です');
  if (!recording) throw new Error('録画されていません');
  const current = recording;
  recording = null;
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = null;
  await new Promise((resolve, reject) => current.stream.end((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath(), ['-y', '-i', current.tempPath, '-map', '0', '-c', 'copy', current.finalPath], { windowsHide: true });
    let errorText = '';
    process.stderr.on('data', (data) => { errorText += data.toString(); });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`MKVの作成に失敗しました (${code})\n${errorText.slice(-900)}`)));
  });
  fs.rmSync(current.tempPath, { force: true });
  return { path: current.finalPath, bytes: fs.statSync(current.finalPath).size };
});
ipcMain.handle('cancel-recording', async (event) => {
  if (!isTrusted(event)) throw new Error('許可されていない操作です');
  if (!recording) return;
  const current = recording;
  recording = null;
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  blockerId = null;
  await new Promise((resolve) => current.stream.end(resolve));
  fs.rmSync(current.tempPath, { force: true });
});
ipcMain.handle('show-in-folder', (event, filePath) => {
  if (!isTrusted(event) || typeof filePath !== 'string' || !['.mkv', '.mov'].includes(path.extname(filePath).toLowerCase()) || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});
ipcMain.handle('ask-convert-mov', async (_event, mkvPath) => {
  if (!isTrusted(_event)) throw new Error('許可されていない操作です');
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'MOVへ変換',
    message: 'MOVに変換しますか？',
    detail: `編集ソフトで扱いやすいH.264・AACのMOVを作成します。元のMKVは残ります。\n\n${path.basename(mkvPath)}`,
    buttons: ['MOVに変換', 'MKVのまま'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  return result.response === 0;
});
ipcMain.handle('convert-to-mov', async (_event, mkvPath) => {
  if (!isTrusted(_event)) throw new Error('許可されていない操作です');
  if (!mkvPath || path.extname(mkvPath).toLowerCase() !== '.mkv' || !fs.existsSync(mkvPath)) {
    throw new Error('変換するMKVファイルが見つかりません');
  }
  const directory = path.dirname(mkvPath);
  const base = path.basename(mkvPath, path.extname(mkvPath));
  let movPath = path.join(directory, `${base}.mov`);
  let index = 2;
  while (fs.existsSync(movPath)) movPath = path.join(directory, `${base}-${index++}.mov`);
  await new Promise((resolve, reject) => {
    const args = ['-y', '-i', mkvPath, '-map', '0:v:0', '-map', '0:a?', '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', movPath];
    const process = spawn(ffmpegPath(), args, { windowsHide: true });
    let errorText = '';
    process.stderr.on('data', (data) => { errorText += data.toString(); });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`MOV変換に失敗しました (${code})\n${errorText.slice(-1200)}`)));
  });
  return { path: movPath, bytes: fs.statSync(movPath).size };
});

function configureUpdater() {
  if (!app.isPackaged || !['win32', 'darwin'].includes(process.platform)) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => send('update-status', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send('update-status', { state: 'current' }));
  autoUpdater.on('download-progress', (p) => send('update-status', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send('update-status', { state: 'ready', version: info.version }));
  autoUpdater.on('error', (error) => send('update-status', { state: 'error', message: error.message }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2500);
}
ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall(false, true));
app.whenReady().then(() => { createWindow(); configureUpdater(); setTimeout(recoverInterruptedRecording, 1200); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
