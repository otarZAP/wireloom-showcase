import './ui/style.css';
import { S, load, onChange, readAutosave, loadPrefs } from './ui/store.js';
import { parseProject } from './core/index.js';
import { renderBoardView, initBoard, fitZoom } from './ui/board.js';
import * as P from './ui/panels.js';
import { initCommands, run, openText, guardUnsaved, VERSION } from './ui/commands.js';
import { desktop } from './ui/files.js';
import { LOGO, FAVICON } from './ui/brand.js';
import exampleText from '../examples/gps-trail-logger.wireloom?raw';

document.getElementById('brand').innerHTML = LOGO + '<span>Wireloom</span>';
document.getElementById('favicon').href = FAVICON;

// Redraw only what an event touched: hover must stay cheap, dragging redraws the board only.
onChange(what => {
  if (what === 'hover') { P.renderStatus(); return; }
  if (what === 'hover+board') { renderBoardView(); P.renderStatus(); return; }
  if (what === 'board') { renderBoardView(); P.renderStatus(); P.renderTop(); return; }
  if (what === 'dirty') { P.renderTop(); if (desktop) desktop.setDirty(S.dirty); return; }
  if (what === 'focus-label') { const i = document.getElementById('partLabel'); if (i) { i.focus(); i.select(); } return; }
  renderBoardView(); P.renderTop(); P.renderLibrary(); P.renderInspector(); P.renderChecks(); P.renderNets(); P.renderWireList(); P.renderStatus();
  if (desktop) desktop.setDirty(S.dirty);
});

loadPrefs();
P.applyBottom();
initBoard(); P.initLibrary(); P.initInspector(); P.initNets(); P.initWireList(); initCommands();

// Start where you left off; otherwise open the example project so the app isn't empty.
const firstRun = !localStorage.getItem('wireloom.prefs.v1');
const saved = readAutosave();
let restored = false;
if (saved && saved.project) {
  try { load(parseProject(JSON.stringify(saved.project)), { fileName: saved.fileName, filePath: saved.filePath, dirty: !!saved.dirty }); restored = true; }
  catch { /* fall through to the example */ }
}
if (!restored) load(parseProject(exampleText), { fileName: null });
if (firstRun) { S.zoom = fitZoom(); P.renderStatus(); renderBoardView(); }

// ---- desktop shell (Electron) ----
if (desktop) {
  desktop.onMenu(cmd => run(cmd));
  desktop.onOpenFile(async f => { if (await guardUnsaved()) await openText(f); });
  desktop.onMenuOpen(async p => { if (await guardUnsaved()) { const f = await desktop.openPath(p); if (f) await openText(f); } });
  desktop.onCloseRequest(async () => desktop.confirmClose(await guardUnsaved()));
  desktop.onUpdate(u => {
    const el = document.getElementById('statusUpdate');
    el.className = 'upd' + (u.state === 'ready' ? ' avail' : '');
    el.textContent = { checking: 'Checking for updates…', available: `Downloading v${u.version}…`, progress: `Downloading update… ${u.percent}%`,
      ready: `Update v${u.version} ready — click to restart`, none: `Wireloom ${VERSION} is up to date`, error: 'Update check unavailable' }[u.state] || '';
    el.onclick = u.state === 'ready' ? () => run('installUpdate') : null;
    if (u.state === 'none') setTimeout(() => { if (el.textContent.includes('up to date')) el.textContent = ''; }, 6000);
  });
  desktop.ready();                       // main replies with a file passed on the command line, if any
} else {
  document.getElementById('statusUpdate').textContent = `Wireloom ${VERSION} · web`;
}
