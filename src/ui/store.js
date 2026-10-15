// App state, undo/redo, autosave. Everything that changes the project goes through
// edit() (or the drag start/finish pair), so undo, "unsaved" and re-routing stay right.

import { routeProject, analyse, migrate } from '../core/index.js';

export const S = {
  project: null, fileName: null, filePath: null, dirty: false,
  view: 'both', wireMode: 'routed', zoom: 14, tool: 'select',
  selected: null, pendingPin: null, hover: null, hoverNet: null, pinnedNet: null,
  routing: null, analysis: null, routeMs: 0, dragging: false,
  done: new Set(),                       // wire-list rows ticked off at the bench (per session)
  libQuery: '', libOpen: null, bottomOpen: true,
};

const undoStack = [], redoStack = [];
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
/** what: 'all' (everything) | 'board' (board only, e.g. while dragging) | 'hover' (status + maybe board). */
export function emit(what = 'all') { for (const fn of listeners) fn(what); }

export function reroute(mode) {
  const t = performance.now();
  const m = mode || (S.wireMode === 'routed' && !S.dragging ? 'routed' : 'ratsnest');
  S.routing = routeProject(S.project, m);
  S.routeMs = performance.now() - t;
  S.analysis = analyse(S.project, S.routing);
}

export function load(project, { fileName = null, filePath = null, dirty = false } = {}) {
  S.project = migrate(project);
  Object.assign(S, { fileName, filePath, dirty, selected: null, pendingPin: null, pinnedNet: null, hoverNet: null, hover: null });
  S.done = new Set();
  undoStack.length = 0; redoStack.length = 0;
  reroute(); emit('all'); autosave();
}

export const snapshot = () => JSON.stringify(S.project);
export function pushUndo(snap) { undoStack.push(snap); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0; }
export function setDirty(d = true) { S.dirty = d; emit('dirty'); }

/** Apply an edit with undo support. A no-op edit leaves no history. */
export function edit(fn, { route = true } = {}) {
  const before = snapshot();
  const result = fn(S.project);
  if (snapshot() === before) { emit('all'); return result; }
  pushUndo(before);
  S.dirty = true;
  if (route) reroute();
  emit('all'); autosave();
  return result;
}

export function undo() { if (!undoStack.length) return false; redoStack.push(snapshot()); restore(undoStack.pop()); return true; }
export function redo() { if (!redoStack.length) return false; undoStack.push(snapshot()); restore(redoStack.pop()); return true; }
function restore(snap) {
  S.project = JSON.parse(snap);
  if (S.selected && !S.project.parts.some(p => p.id === S.selected)) S.selected = null;
  S.pendingPin = null; S.dirty = true;
  reroute(); emit('all'); autosave();
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/* ---- autosave: a per-machine safety net, not the real save ---- */
const AUTOSAVE = 'wireloom.autosave.v1';
let timer = null;
export function autosave() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE, JSON.stringify({ project: S.project, fileName: S.fileName, filePath: S.filePath, dirty: S.dirty, at: Date.now() })); } catch { /* storage full or blocked */ }
  }, 400);
}
export function readAutosave() { try { return JSON.parse(localStorage.getItem(AUTOSAVE)); } catch { return null; } }

/* ---- view preferences ---- */
const PREFS = 'wireloom.prefs.v1';
export function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify({ view: S.view, wireMode: S.wireMode, zoom: S.zoom, bottomOpen: S.bottomOpen })); } catch { /* ignore */ }
}
export function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS)); if (p) for (const k of ['view', 'wireMode', 'zoom', 'bottomOpen']) if (k in p) S[k] = p[k]; } catch { /* ignore */ }
}
