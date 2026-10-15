// Every action goes through run(cmd): toolbar buttons, the desktop menu and keyboard
// shortcuts all call the same thing, so they can never disagree.

import { S, edit, emit, undo, redo, load, savePrefs, reroute, setDirty } from './store.js';
import { parseProject, stringify, newProject, partById, modOf, fitPart, removePart, renderBoard, wireRows,
         wireListCSV, buildSheetHTML } from '../core/index.js';
import { openProjectFile, saveProjectFile, exportFile, forgetHandle, isDesktop, desktop } from './files.js';
import { dialog, unsavedDialog, toast, esc, dialogOpen } from './dialogs.js';
import { fitZoom, nudge } from './board.js';
import { applyBottom } from './panels.js';
import exampleText from '../../examples/gps-trail-logger.wireloom?raw';

/* global __APP_VERSION__ */
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const ZOOMS = [6, 8, 9, 11, 14, 17, 21, 26, 32];
const slug = s => (String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled');

/* ------------------------------ unsaved guard ------------------------------ */
/** Resolves true if it's OK to throw away the current project (saved, or the user said so). */
export async function guardUnsaved() {
  if (!S.dirty) return true;
  const r = await unsavedDialog(S.project.name);
  if (r === 'cancel') return false;
  if (r === 'save') return await save(false);
  return true;
}

/* ------------------------------ file commands ------------------------------ */
async function save(saveAs) {
  const text = stringify(S.project);
  const name = S.fileName || slug(S.project.name) + '.wireloom';
  try {
    const r = await saveProjectFile({ text, name, path: S.filePath, saveAs: saveAs || (!isDesktop && !S.fileName) });
    if (!r) return false;
    S.fileName = r.name; S.filePath = r.path || null;
    setDirty(false); emit('all');
    toast(`Saved ${r.name}`);
    return true;
  } catch (err) { toast('Save failed: ' + err.message, true, 5000); return false; }
}

export async function openText({ text, name, path }) {
  try {
    const p = parseProject(text);
    load(p, { fileName: name, filePath: path || null });
    toast(`Opened ${name}`);
  } catch (err) {
    await dialog({ title: `Couldn't open ${esc(name || 'that file')}`, body: `<pre>${esc(err.message)}</pre>`, buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }] });
  }
}

async function newDialog() {
  const r = await dialog({
    title: 'New project',
    body: `<div class="field"><span>Name</span><input class="input" name="name" value="Untitled build" /></div>
      <div class="field"><span>Board</span><select class="select" name="preset">
        <option value="40x30">40×30 holes · ~10×8 cm</option>
        <option value="30x56">30×56 holes · ~8×14 cm (portrait)</option>
        <option value="56x30">56×30 holes · ~14×8 cm (landscape)</option>
        <option value="35x59">35×59 holes · 9×15 cm board</option>
        <option value="27x37">27×37 holes · 7×9 cm board</option>
        <option value="custom">Custom…</option></select></div>
      <div class="field"><span>Custom</span><span><input class="num" name="cols" type="number" value="40" min="4" max="200" /> ×
        <input class="num" name="rows" type="number" value="30" min="4" max="200" /> holes</span></div>
      <p class="muted small">You can resize the board any time from the toolbar.</p>`,
    buttons: [{ id: 'ok', label: 'Create', kind: 'primary' }, { id: 'cancel', label: 'Cancel', cancel: true }],
  });
  if (r.button !== 'ok') return;
  let [cols, rows] = r.form.preset === 'custom' ? [+r.form.cols, +r.form.rows] : r.form.preset.split('x').map(Number);
  cols = Math.max(4, Math.min(200, cols | 0)); rows = Math.max(4, Math.min(200, rows | 0));
  forgetHandle();
  load(newProject(r.form.name.trim() || 'Untitled build', cols, rows), { fileName: null });
  S.zoom = fitZoom(); emit('all');
}

function helpDialog() {
  const k = (keys, what) => `<tr><td>${keys.map(x => `<kbd>${x}</kbd>`).join(' ')}</td><td>${what}</td></tr>`;
  dialog({
    title: 'Wireloom — shortcuts &amp; how-to', width: 640,
    body: `<p class="small">Place modules from the <b>Library</b>, wire their pins with <b>Connect</b>, and Wireloom routes every
      connection along the hole grid. The <b>wire list</b> is your bench checklist; <b>Build sheet</b> exports the lot.</p>
      <table>${[
        k(['V'], 'Select / move tool'), k(['C'], 'Connect tool — click two pins (Shift-click to chain)'), k(['X'], 'Disconnect tool — click a pin'),
        k(['1', '2', '3'], 'View: both (x-ray) · front · back (solder side, mirrored)'), k(['W'], 'Cycle wires: routed · ratsnest · off'),
        k(['R'], 'Rotate selected part'), k(['F'], 'Flip selected part to the other face'), k(['M'], 'Mirror its pinout (if your module is reversed)'),
        k(['Del'], 'Delete selected part'), k(['←', '↑', '→', '↓'], 'Nudge one hole (Shift: five)'),
        k(['+', '−', '0'], 'Zoom in · out · fit (or Ctrl+scroll)'), k(['Ctrl', 'Z'], 'Undo'), k(['Ctrl', 'Y'], 'Redo'),
        k(['Ctrl', 'N'], 'New'), k(['Ctrl', 'O'], 'Open'), k(['Ctrl', 'S'], 'Save'), k(['Ctrl', 'Shift', 'S'], 'Save as'),
        k(['Esc'], 'Cancel / deselect'), k(['?'], 'This help')].join('')}</table>
      <p class="small muted" style="margin-top:12px">Holes are numbered from the front-left corner. Back-side parts are seen from underneath,
      so their pinouts mirror automatically. Pinouts marked <span class="badge warn">unverified</span> are modelled — hover each pin and
      compare with your board before soldering.</p>`,
    buttons: [{ id: 'ok', label: 'Got it', kind: 'primary' }],
  });
}

async function aboutDialog() {
  const r = await dialog({
    title: 'About Wireloom',
    body: `<p><b>Wireloom ${esc(VERSION)}</b> — a module-level perfboard planner. Place breakout boards, route the wires, get a
      bench-ready wire list.</p>
      <p class="small muted">${isDesktop ? 'Desktop app. Updates are checked automatically at start-up.' : 'Running in a browser. The desktop app adds native files and automatic updates.'}</p>
      <p class="small muted">Projects are plain JSON (<code>.wireloom</code>), modules are <code>.module.json</code> — see docs/FORMATS.md.</p>`,
    buttons: isDesktop ? [{ id: 'upd', label: 'Check for updates' }, { id: 'ok', label: 'Close', kind: 'primary' }] : [{ id: 'ok', label: 'Close', kind: 'primary' }],
  });
  if (r.button === 'upd') run('checkUpdates');
}

/* ------------------------------ the dispatcher ------------------------------ */
export async function run(c) {
  const [k, v] = String(c).split(':');
  const sel = S.selected && partById(S.project, S.selected);
  switch (k) {
    case 'new':    if (await guardUnsaved()) await newDialog(); break;
    case 'open':   if (await guardUnsaved()) { const f = await openProjectFile(); if (f) await openText(f); } break;
    case 'example':if (await guardUnsaved()) { forgetHandle(); load(parseProject(exampleText), { fileName: null }); } break;
    case 'save':   await save(false); break;
    case 'saveAs': await save(true); break;
    case 'undo':   if (inTextField()) document.execCommand('undo'); else if (!undo()) toast('Nothing to undo'); break;
    case 'redo':   if (inTextField()) document.execCommand('redo'); else if (!redo()) toast('Nothing to redo'); break;

    case 'tool':
      S.tool = v; S.pendingPin = null;
      if (v !== 'select' && S.view === 'front') { S.view = 'both'; toast('Pins live on the back — switched to the Both view'); }
      emit('all'); break;
    case 'view':   S.view = v; S.pendingPin = null; savePrefs(); emit('all'); break;
    case 'wires':  S.wireMode = v; savePrefs(); reroute(); emit('all'); break;
    case 'cycleWires': run('wires:' + ({ routed: 'ratsnest', ratsnest: 'off', off: 'routed' })[S.wireMode]); break;
    case 'zoomIn':  S.zoom = ZOOMS.find(z => z > S.zoom) || ZOOMS.at(-1); savePrefs(); emit('all'); break;
    case 'zoomOut': S.zoom = [...ZOOMS].reverse().find(z => z < S.zoom) || ZOOMS[0]; savePrefs(); emit('all'); break;
    case 'zoomFit': S.zoom = fitZoom(); savePrefs(); emit('all'); break;

    case 'swapBoard':
      edit(p => { [p.board.cols, p.board.rows] = [p.board.rows, p.board.cols]; p.parts.forEach(x => fitPart(x, modOf(p, x), p.board)); });
      toast(`Board is now ${S.project.board.cols}×${S.project.board.rows}`); break;
    case 'boardSize': {
      const cols = Math.max(4, Math.min(200, +document.getElementById('boardCols').value | 0));
      const rows = Math.max(4, Math.min(200, +document.getElementById('boardRows').value | 0));
      edit(p => { p.board.cols = cols; p.board.rows = rows; p.parts.forEach(x => fitPart(x, modOf(p, x), p.board)); });
      break;
    }

    case 'rotate': if (sel) edit(p => { const q = partById(p, sel.id), m = modOf(p, q); const prev = q.rot; q.rot = (q.rot + 90) % 360;
                     const [w, h] = (q.rot % 180 === 0) ? [m.size.w, m.size.h] : [m.size.h, m.size.w];
                     if (w > p.board.cols || h > p.board.rows) { q.rot = prev; toast("It won't fit rotated on this board", true); } else fitPart(q, m, p.board); }); break;
    case 'flip':   if (sel) edit(p => { const q = partById(p, sel.id); q.side = q.side === 'front' ? 'back' : 'front'; }); break;
    case 'mirror': if (sel) edit(p => { const q = partById(p, sel.id); q.mirrorPins = !q.mirrorPins; }); break;
    case 'delete': if (sel) { const label = sel.label || sel.id; edit(p => removePart(p, sel.id)); S.selected = null; emit('all'); toast(`Removed ${label} — Ctrl+Z to undo`); } break;
    case 'nudge':  { const [dx, dy] = v.split(',').map(Number); nudge(dx, dy); break; }

    case 'exportSVG': {
      const svg = renderBoard(S.project, S.routing, S.analysis, { view: S.view, title: `${S.project.name} — ${({ both: 'x-ray', front: 'front', back: 'solder side (mirrored)' })[S.view]}`, idPrefix: 'ex' });
      await exportFile(`${slug(S.project.name)}-${S.view}.svg`, svg, 'image/svg+xml'); break;
    }
    case 'exportCSV':
      await exportFile(`${slug(S.project.name)}-wires.csv`, wireListCSV(wireRows(S.routing)), 'text/csv'); break;
    case 'exportSheet': {
      reroute('routed');                                // the sheet always uses fully routed wires
      const html = buildSheetHTML(S.project, S.routing, S.analysis, { version: VERSION });
      reroute(); await exportFile(`${slug(S.project.name)}-build-sheet.html`, html, 'text/html');
      toast('Build sheet exported — open it in a browser to read or print'); break;
    }
    case 'print': window.print(); break;

    case 'help': helpDialog(); break;
    case 'about': aboutDialog(); break;
    case 'checkUpdates': if (desktop) { desktop.checkForUpdates(); toast('Checking for updates…'); } break;
    case 'installUpdate': if (desktop) desktop.installUpdate(); break;
    case 'toggleWireList': S.bottomOpen = !S.bottomOpen; savePrefs(); applyBottom(); emit('all'); break;
    case 'escape':
      if (S.pendingPin) S.pendingPin = null;
      else if (S.tool !== 'select') S.tool = 'select';
      else { S.selected = null; S.pinnedNet = null; }
      emit('all'); break;
    default: console.warn('unknown command', c);
  }
}

const inTextField = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };

/* ------------------------------ wiring up ------------------------------ */
export function initCommands() {
  document.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b && !b.disabled) run(b.dataset.cmd); });
  window.addEventListener('wl-cmd', e => run(e.detail));

  const pn = document.getElementById('projName');
  pn.addEventListener('change', () => { const v = pn.value.trim() || 'Untitled'; edit(p => { p.name = v; }, { route: false }); });
  pn.addEventListener('keydown', e => { if (e.key === 'Enter') pn.blur(); });
  for (const id of ['boardCols', 'boardRows']) {
    const i = document.getElementById(id);
    i.addEventListener('change', () => run('boardSize'));
    i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  }

  document.addEventListener('keydown', e => {
    if (dialogOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey, key = e.key;
    if (ctrl) {
      const map = { n: 'new', o: 'open', s: e.shiftKey ? 'saveAs' : 'save', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', p: 'print', e: 'exportSheet' };
      const c = map[key.toLowerCase()];
      if (c) { if ((c === 'undo' || c === 'redo') && inTextField()) return; e.preventDefault(); run(c); }
      return;
    }
    if (inTextField()) { if (key === 'Escape') document.activeElement.blur(); return; }
    const step = e.shiftKey ? 5 : 1;
    const map = {
      v: 'tool:select', c: 'tool:connect', x: 'tool:disconnect', 1: 'view:both', 2: 'view:front', 3: 'view:back',
      w: 'cycleWires', r: 'rotate', f: 'flip', m: 'mirror', Delete: 'delete', Backspace: 'delete',
      '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut', 0: 'zoomFit', '?': 'help', Escape: 'escape',
      ArrowLeft: `nudge:${-step},0`, ArrowRight: `nudge:${step},0`, ArrowUp: `nudge:0,${-step}`, ArrowDown: `nudge:0,${step}`,
    };
    const c = map[key] || map[key.toLowerCase()];
    if (c) { e.preventDefault(); run(c); }
  });

  window.addEventListener('beforeunload', e => { if (S.dirty && !isDesktop) { e.preventDefault(); e.returnValue = ''; } });
}
