// File I/O that works in both shells:
//  - desktop: the Electron preload exposes window.wireloom (native dialogs, real paths)
//  - browser: File System Access API where available (Chromium), else upload/download.

const api = typeof window !== 'undefined' ? window.wireloom : null;
export const isDesktop = !!api;
export const desktop = api;

let handle = null;                       // browser: the file we opened/saved, for plain "Save"

const PROJECT_TYPES = [{ description: 'Wireloom project', accept: { 'application/json': ['.wireloom'] } }];

/** -> { text, name, path } or null if cancelled. */
export async function openProjectFile() {
  if (api) return api.openProject();
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [...PROJECT_TYPES, { description: 'JSON', accept: { 'application/json': ['.json'] } }] });
      handle = h; const f = await h.getFile();
      return { text: await f.text(), name: f.name, path: null };
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  return pickFile('.wireloom,.json');
}

/** Save; `saveAs` forces a new location. -> { name, path } or null if cancelled. */
export async function saveProjectFile({ text, name, path, saveAs }) {
  if (api) return api.saveProject({ text, name, path: saveAs ? null : path });
  if (window.showSaveFilePicker) {
    try {
      if (!handle || saveAs) handle = await window.showSaveFilePicker({ suggestedName: name, types: PROJECT_TYPES });
      const w = await handle.createWritable(); await w.write(text); await w.close();
      return { name: handle.name, path: null };
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  download(name, text, 'application/json');
  return { name, path: null };
}
export function forgetHandle() { handle = null; }

/** Export a text file (SVG, CSV, HTML). */
export async function exportFile(name, text, mime) {
  if (api) return api.exportFile({ name, text });
  download(name, text, mime);
  return { name };
}

/** -> { text, name } or null. */
export async function importModuleFile() {
  if (api) return api.importModule();
  return pickFile('.json');
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = async () => { const f = input.files[0]; resolve(f ? { text: await f.text(), name: f.name, path: null } : null); };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
