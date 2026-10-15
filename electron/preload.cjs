// The only bridge between the page and the OS. The page gets these functions and
// nothing else (contextIsolation + sandbox): no Node, no filesystem, no shell.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('wireloom', {
  openProject:   () => ipcRenderer.invoke('wl:open-project'),
  openPath:      p => ipcRenderer.invoke('wl:open-path', p),
  saveProject:   a => ipcRenderer.invoke('wl:save-project', a),
  exportFile:    a => ipcRenderer.invoke('wl:export-file', a),
  importModule:  () => ipcRenderer.invoke('wl:import-module'),
  setDirty:      d => ipcRenderer.send('wl:set-dirty', !!d),
  confirmClose:  ok => ipcRenderer.send('wl:confirm-close', !!ok),
  ready:         () => ipcRenderer.send('wl:ready'),
  checkForUpdates: () => ipcRenderer.send('wl:check-updates'),
  installUpdate: () => ipcRenderer.send('wl:install-update'),
  onMenu:        cb => on('wl:menu', cb),
  onMenuOpen:    cb => on('wl:menu-open', cb),
  onOpenFile:    cb => on('wl:open-file', cb),
  onCloseRequest: cb => on('wl:close-request', cb),
  onUpdate:      cb => on('wl:update', cb),
});
