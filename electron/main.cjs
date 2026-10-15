// Wireloom desktop shell (Electron main process).
// The whole app is dist/index.html; this file adds native files, a menu, the
// unsaved-changes guard, the .wireloom file association and automatic updates.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SMOKE = process.argv.includes('--smoke-test');     // boot hidden, self-check, exit (used by CI/tests)
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wireloom-smoke-')));

let win = null, dirty = false, forceClose = false;
let pendingFile = fileFromArgs(process.argv);

/* ------------------------------ single instance ------------------------------ */
const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) app.quit();                             // a second launch hands its file to the first, then exits
app.on('second-instance', (_e, argv) => {
  const f = fileFromArgs(argv);
  if (win) { if (f) sendOpen(f); if (win.isMinimized()) win.restore(); win.focus(); }
});

function fileFromArgs(argv) {
  return argv.slice(1).find(a => /\.wireloom$/i.test(a) && fs.existsSync(a)) || null;
}
function readProject(p) { return { text: fs.readFileSync(p, 'utf8'), name: path.basename(p), path: p }; }
function sendOpen(p) {
  try { win.webContents.send('wl:open-file', readProject(p)); addRecent(p); }
  catch (e) { dialog.showErrorBox('Could not open file', `${p}\n\n${e.message}`); }
}
/** Write via a temp file + rename, so a crash mid-save can't leave a half-written project. */
function writeAtomic(target, text) {
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);
}

/* ------------------------------ recent files ------------------------------ */
const recentPath = () => path.join(app.getPath('userData'), 'recent.json');
function recent() { try { return JSON.parse(fs.readFileSync(recentPath(), 'utf8')).filter(f => fs.existsSync(f)); } catch { return []; } }
function addRecent(p) {
  const list = [p, ...recent().filter(f => f !== p)].slice(0, 8);
  try { fs.writeFileSync(recentPath(), JSON.stringify(list)); } catch { /* not fatal */ }
  app.addRecentDocument(p);
  buildMenu();
}

/* ------------------------------ window ------------------------------ */
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 980, minHeight: 640, show: false, backgroundColor: '#0d1117',
    title: 'Wireloom', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.on('close', e => {                               // let the page ask "save changes?" first
    if (forceClose || !dirty || SMOKE) return;
    e.preventDefault();
    win.webContents.send('wl:close-request');
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  buildMenu();
}

/* ------------------------------ menu ------------------------------ */
function buildMenu() {
  const send = cmd => () => { if (win) win.webContents.send('wl:menu', cmd); };
  // The page handles every shortcut itself (same code as the web build), so the menu
  // only *displays* accelerators — registering them too would fire actions twice.
  const item = (label, cmd, accelerator) => ({ label, click: send(cmd), accelerator, registerAccelerator: false });
  const rec = recent();
  const template = [
    { label: '&File', submenu: [
      item('New project…', 'new', 'Ctrl+N'), item('Open…', 'open', 'Ctrl+O'),
      { label: 'Open recent', enabled: rec.length > 0, submenu: rec.map(f => ({ label: f, click: () => win && win.webContents.send('wl:menu-open', f) })) },
      item('Open the example project', 'example'),
      { type: 'separator' },
      item('Save', 'save', 'Ctrl+S'), item('Save as…', 'saveAs', 'Ctrl+Shift+S'),
      { type: 'separator' },
      item('Export build sheet…', 'exportSheet', 'Ctrl+E'), item('Export SVG drawing…', 'exportSVG'), item('Export wire list (CSV)…', 'exportCSV'),
      item('Print…', 'print', 'Ctrl+P'),
      { type: 'separator' }, { role: 'quit', label: 'Exit' } ] },
    { label: '&Edit', submenu: [
      item('Undo', 'undo', 'Ctrl+Z'), item('Redo', 'redo', 'Ctrl+Y'), { type: 'separator' },
      item('Rotate part', 'rotate', 'R'), item('Flip to the other face', 'flip', 'F'), item('Mirror pinout', 'mirror', 'M'),
      item('Delete part', 'delete', 'Delete'), { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] },
    { label: '&View', submenu: [
      item('Both (x-ray)', 'view:both', '1'), item('Front', 'view:front', '2'), item('Back — solder side', 'view:back', '3'),
      { type: 'separator' },
      item('Wires: routed', 'wires:routed'), item('Wires: ratsnest', 'wires:ratsnest'), item('Wires: off', 'wires:off'),
      { type: 'separator' },
      item('Zoom in', 'zoomIn', '+'), item('Zoom out', 'zoomOut', '-'), item('Fit board', 'zoomFit', '0'),
      item('Show / hide wire list', 'toggleWireList'),
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools', label: 'Developer tools' } ] },
    { label: '&Tools', submenu: [ item('Select / move', 'tool:select', 'V'), item('Connect pins', 'tool:connect', 'C'), item('Disconnect a pin', 'tool:disconnect', 'X') ] },
    { label: '&Help', submenu: [
      item('Shortcuts && how-to', 'help', '?'), item('Check for updates…', 'checkUpdates'),
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' }, item('About Wireloom', 'about') ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ IPC ------------------------------ */
const PROJECT_FILTERS = [{ name: 'Wireloom project', extensions: ['wireloom'] }, { name: 'JSON', extensions: ['json'] }];

ipcMain.handle('wl:open-project', async () => {
  const r = await dialog.showOpenDialog(win, { filters: PROJECT_FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  addRecent(r.filePaths[0]);
  return readProject(r.filePaths[0]);
});
ipcMain.handle('wl:open-path', async (_e, p) => (fs.existsSync(p) ? (addRecent(p), readProject(p)) : null));
ipcMain.handle('wl:save-project', async (_e, { text, name, path: p }) => {
  let target = p;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [PROJECT_FILTERS[0]] });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  writeAtomic(target, text);
  addRecent(target);
  return { name: path.basename(target), path: target };
});
ipcMain.handle('wl:export-file', async (_e, { name, text }) => {
  const ext = path.extname(name).slice(1) || 'txt';
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  writeAtomic(r.filePath, text);
  if (ext === 'html') shell.openPath(r.filePath);      // build sheets open straight in the browser
  return { name: path.basename(r.filePath), path: r.filePath };
});
ipcMain.handle('wl:import-module', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Wireloom module', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { text: fs.readFileSync(r.filePaths[0], 'utf8'), name: path.basename(r.filePaths[0]) };
});
ipcMain.on('wl:set-dirty', (_e, d) => { dirty = !!d; if (win) win.setDocumentEdited(dirty); });
ipcMain.on('wl:confirm-close', (_e, ok) => { if (ok && win) { forceClose = true; win.close(); } });
ipcMain.on('wl:check-updates', () => checkForUpdates());
ipcMain.on('wl:install-update', () => { if (updater) { forceClose = true; updater.quitAndInstall(); } });
ipcMain.on('wl:ready', async () => {
  if (pendingFile) { sendOpen(pendingFile); pendingFile = null; }
  if (SMOKE) {
    const r = await win.webContents.executeJavaScript(`({
      parts: document.querySelectorAll('#boardHost [data-part]').length,
      status: document.getElementById('statusInfo').textContent,
      desktop: !!window.wireloom })`);
    console.log('WIRELOOM_SMOKE ' + JSON.stringify({ ...r, version: app.getVersion(), packaged: app.isPackaged }));
    app.exit(r.parts > 0 && r.desktop ? 0 : 1);
  }
});

/* ------------------------------ updates ------------------------------ */
let updater = null;
function setupUpdater() {
  if (!app.isPackaged || SMOKE) return;                 // only installed builds update themselves
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const send = s => { if (win) win.webContents.send('wl:update', s); };
  updater.on('checking-for-update', () => send({ state: 'checking' }));
  updater.on('update-available', i => send({ state: 'available', version: i.version }));
  updater.on('update-not-available', () => send({ state: 'none' }));
  updater.on('download-progress', p => send({ state: 'progress', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', i => send({ state: 'ready', version: i.version }));
  updater.on('error', () => send({ state: 'error' }));
  setTimeout(() => checkForUpdates(), 4000);
}
function checkForUpdates() {
  if (!updater) { if (win) win.webContents.send('wl:update', { state: app.isPackaged ? 'error' : 'none' }); return; }
  updater.checkForUpdates().catch(() => { if (win) win.webContents.send('wl:update', { state: 'error' }); });
}

/* ------------------------------ lifecycle ------------------------------ */
app.whenReady().then(() => { if (!gotLock) return; createWindow(); setupUpdater(); });
app.on('window-all-closed', () => app.quit());
