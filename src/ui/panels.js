// Side panels, wire list, top bar and status bar. Each render* function redraws one
// region from state; inputs commit on change (Enter / blur), never per keystroke.

import { modOf, partById, partPins, netOfPin, summarise, wireRows, cutList, totalLengthCm, holeLabel, netClass,
         parseModule, addPart, renameNet } from '../core/index.js';
import { S, edit, emit, canUndo, canRedo, savePrefs } from './store.js';
import { allModules, addUserModule, removeUserModule, moduleTemplate } from './library.js';
import { esc, toast, dialog } from './dialogs.js';
import { importModuleFile, exportFile } from './files.js';

const $ = id => document.getElementById(id);
const mm = holes => Math.round(holes * 2.54);
const cmd = c => window.dispatchEvent(new CustomEvent('wl-cmd', { detail: c }));

/* ============================== top bar + toolbar ============================== */
export function renderTop() {
  const n = $('projName');
  if (document.activeElement !== n) n.value = S.project.name || '';
  $('fileName').textContent = S.fileName ? '— ' + S.fileName : '— not saved yet';
  $('dirty').textContent = S.dirty ? '● unsaved' : '';
  document.querySelector('[data-cmd="undo"]').disabled = !canUndo();
  document.querySelector('[data-cmd="redo"]').disabled = !canRedo();
  for (const b of document.querySelectorAll('.toolbar [data-cmd]')) {
    const [k, v] = b.dataset.cmd.split(':');
    if (v) b.classList.toggle('on', (k === 'tool' && S.tool === v) || (k === 'view' && S.view === v) || (k === 'wires' && S.wireMode === v));
  }
  const c = $('boardCols'), r = $('boardRows');
  if (document.activeElement !== c) c.value = S.project.board.cols;
  if (document.activeElement !== r) r.value = S.project.board.rows;
  $('boardMm').textContent = `${mm(S.project.board.cols)}×${mm(S.project.board.rows)} mm`;
  document.title = `${S.dirty ? '● ' : ''}${S.project.name || 'Untitled'} — Wireloom`;
}

/* ============================== library ============================== */
export function renderLibrary() {
  const q = S.libQuery.trim().toLowerCase();
  const mods = allModules().filter(m => !q || [m.name, m.id, m.category, m.note].join(' ').toLowerCase().includes(q));
  let h = `<div class="panel"><h3>Library <span class="count">${mods.length}</span><span class="grow"></span>
            <button class="btn ghost tiny" id="libImport" title="Add a module definition (.module.json)">Import…</button>
            <button class="btn ghost tiny" id="libTemplate" title="Download a module template to fill in">Template</button></h3>
          <input class="search" id="libSearch" placeholder="Search modules…" value="${esc(S.libQuery)}" />`;
  let cat = null;
  for (const m of mods) {
    if (m.category !== cat) { cat = m.category; h += `<div class="cat">${esc(cat || 'Other')}</div>`; }
    const open = S.libOpen === m.id, used = S.project.parts.filter(p => p.module === m.id).length;
    h += `<div class="lib-item ${open ? 'open' : ''}" data-mod="${esc(m.id)}">
      <span class="sw" style="background:${esc(m.color || '#2b313b')}"></span>
      <span class="nm">${esc(m.name)}</span>
      <span>${m.verified ? '<span class="badge ok" title="Pinout checked against a real board">verified</span>' : '<span class="badge warn" title="Modelled — check the pinout against your board">unverified</span>'}</span>
      <span class="meta">${m.size.w}×${m.size.h} holes · ${m.pins.length} pins${m.antenna ? ' · ' + esc(m.antenna.band) + ' antenna' : ''}${used ? ` · <b>${used} on board</b>` : ''}${m.origin === 'yours' ? ' · <i>yours</i>' : ''}</span>
      ${open ? `<div class="more">${m.verify ? esc(m.verify) : ''}${m.source ? `<div class="dim tiny" style="margin-top:4px">${esc(m.source)}</div>` : ''}
        <div class="row"><button class="btn primary" data-add="${esc(m.id)}" data-side="front">Add to front</button>
        <button class="btn" data-add="${esc(m.id)}" data-side="back">Add to back</button>
        ${m.origin === 'yours' ? `<button class="btn danger" data-rmmod="${esc(m.id)}">Remove</button>` : ''}</div></div>` : ''}
    </div>`;
  }
  if (!mods.length) h += `<p class="muted small">Nothing matches "${esc(q)}".</p>`;
  h += `</div><div class="panel muted small">Missing a module? Click <b>Template</b>, fill in its size and pin holes,
        then <b>Import…</b> it. Pins are holes on a 0.1" grid, counted from the top-left with the parts side up.</div>`;
  const el = $('libPanel'), focused = document.activeElement && document.activeElement.id === 'libSearch', caret = focused ? document.activeElement.selectionStart : 0;
  el.innerHTML = h;
  if (focused) { const s = $('libSearch'); s.focus(); s.setSelectionRange(caret, caret); }
}

export function initLibrary() {
  const el = $('libPanel');
  el.addEventListener('input', e => { if (e.target.id === 'libSearch') { S.libQuery = e.target.value; renderLibrary(); } });
  el.addEventListener('click', async e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const mod = allModules().find(m => m.id === add.dataset.add);
      const { origin, ...clean } = mod;
      const part = edit(p => {
        p.modules[clean.id] = p.modules[clean.id] || structuredClone(clean);
        return addPart(p, p.modules[clean.id], { side: add.dataset.side });
      });
      if (part) { S.selected = part.id; if (S.view === 'front' && part.side === 'back') S.view = 'both'; emit('all'); toast(`Added ${part.label} to the ${part.side}`); }
      return;
    }
    const rm = e.target.closest('[data-rmmod]');
    if (rm) { removeUserModule(rm.dataset.rmmod); S.libOpen = null; renderLibrary(); toast('Removed from your library (projects keep their own copy)'); return; }
    if (e.target.id === 'libImport') { importModule(); return; }
    if (e.target.id === 'libTemplate') {
      await exportFile('my-module.module.json', JSON.stringify(moduleTemplate(), null, 2) + '\n', 'application/json');
      return;
    }
    const item = e.target.closest('[data-mod]');
    if (item && !e.target.closest('button')) { S.libOpen = S.libOpen === item.dataset.mod ? null : item.dataset.mod; renderLibrary(); }
  });
}

async function importModule() {
  const f = await importModuleFile();
  if (!f) return;
  try {
    const m = parseModule(f.text);
    addUserModule(m); S.libOpen = m.id; S.libQuery = ''; renderLibrary();
    toast(`Imported "${m.name}" into your library`);
  } catch (err) {
    dialog({ title: 'Couldn\'t import that module', body: `<pre>${esc(err.message)}</pre>`, buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }] });
  }
}

/* ============================== inspector ============================== */
export function renderInspector() {
  const el = $('inspector'), p = S.selected && partById(S.project, S.selected);
  const keep = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
  if (!p) {
    const pr = S.project, nPins = pr.parts.reduce((s, x) => s + ((modOf(pr, x) || {}).pins || []).length, 0);
    el.innerHTML = `<div class="panel"><h3>Project</h3>
      <div class="field"><span>Notes</span><textarea class="input" id="projNotes" placeholder="What is this build?">${esc(pr.notes || '')}</textarea></div>
      <div class="field"><span>Board</span><span>${pr.board.cols}×${pr.board.rows} holes · ${mm(pr.board.cols)}×${mm(pr.board.rows)} mm</span></div>
      <div class="field"><span>Contents</span><span>${pr.parts.length} parts · ${nPins} pins · ${pr.nets.length} nets</span></div>
      <p class="muted small" style="margin:10px 0 0">Click a part to inspect it. Drag to move; <b>R</b> rotate, <b>F</b> flip to the other face,
      <b>M</b> mirror its pinout, <b>Del</b> remove. Hover any pin to see its net and hole.</p></div>`;
  } else {
    const m = modOf(S.project, p);
    const pins = partPins(p, m).map(q => { const n = netOfPin(S.project, p.id + ':' + q.name); return { q, n }; });
    el.innerHTML = `<div class="panel"><h3>Part <span class="count mono">${esc(p.id)}</span></h3>
      <div class="field"><span>Label</span><input class="input" id="partLabel" value="${esc(p.label || '')}" /></div>
      <div class="field"><span>Module</span><span>${esc(m.name)} ${m.verified ? '<span class="badge ok">verified</span>' : '<span class="badge warn">unverified</span>'}</span></div>
      <div class="field"><span>Placed</span><span>${holeLabel(p.x, p.y)} · ${p.rot}° · <b>${p.side}</b>${m.offboard ? ' · off-board' : ''}${p.mirrorPins ? ' · pinout mirrored' : ''}</span></div>
      <div class="row">
        <button class="btn" data-cmd2="rotate">⟳ Rotate<kbd>R</kbd></button>
        <button class="btn" data-cmd2="flip">⇄ ${p.side === 'front' ? 'To back' : 'To front'}<kbd>F</kbd></button>
        <button class="btn" data-cmd2="mirror">⇋ Mirror pinout<kbd>M</kbd></button>
        <button class="btn danger" data-cmd2="delete">Delete<kbd>Del</kbd></button>
      </div>
      ${m.verify ? `<div class="note">${esc(m.verify)}</div>` : ''}
      <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">${pins.length} pins · ${pins.filter(x => x.n).length} connected</summary>
        <div class="pinlist">${pins.map(({ q, n }) => `<div title="${esc(q.name)} ${n ? '→ ' + esc(n.name) : ''} @ ${holeLabel(q.x, q.y)}"><span class="sw" style="background:${n ? netClass(S.project, n.class).color : 'transparent'}"></span>${esc(q.name)}${n ? ' <span class="dim">' + esc(n.name) + '</span>' : ''}</div>`).join('')}</div>
      </details></div>`;
  }
  if (keep && $(keep)) $(keep).focus();
}

export function initInspector() {
  const el = $('inspector');
  el.addEventListener('change', e => {
    if (e.target.id === 'partLabel') { const v = e.target.value.trim(); edit(p => { const q = partById(p, S.selected); if (q && v) q.label = v; }); }
    if (e.target.id === 'projNotes') { const v = e.target.value; edit(p => { p.notes = v; }, { route: false }); }
  });
  el.addEventListener('click', e => { const b = e.target.closest('[data-cmd2]'); if (b) cmd(b.dataset.cmd2); });
}

/* ============================== checks ============================== */
export function renderChecks() {
  const lines = summarise(S.project, S.analysis, S.routing);
  const icon = { ok: '✓', bad: '⚠', warn: '!', info: 'i' };
  $('checks').innerHTML = `<div class="panel"><h3>Checks</h3>${lines.map(l => `<div class="check ${l.level}"><i>${icon[l.level]}</i><span>${esc(l.text)}</span></div>`).join('')}</div>`;
}

/* ============================== nets ============================== */
export function renderNets() {
  const el = $('nets'), keep = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.net : null;
  const classes = { ...S.project.netClasses };
  const opts = cls => Object.entries(classes).map(([k, c]) => `<option value="${esc(k)}" ${k === cls ? 'selected' : ''}>${esc(c.label || k)}</option>`).join('');
  const nets = S.project.nets;
  el.innerHTML = `<div class="panel"><h3>Nets <span class="count">${nets.length}</span><span class="grow"></span>
      <button class="btn ghost tiny" data-cmd3="tool:connect" title="Wire pins together (C)">+ Connect</button></h3>
    ${nets.length ? '' : '<p class="muted small">No connections yet. Pick <b>Connect</b> (C), then click two pins.</p>'}
    ${nets.map(n => `<div class="net ${(S.pinnedNet === n.name || S.hoverNet === n.name) ? 'hi' : ''}" data-netrow="${esc(n.name)}" title="${esc(n.pins.join('  '))}">
      <span class="sw" style="background:${netClass(S.project, n.class).color}"></span>
      <input value="${esc(n.name)}" data-net="${esc(n.name)}" spellcheck="false" />
      <select data-netcls="${esc(n.name)}">${opts(n.class)}</select>
      <button class="x" data-netdel="${esc(n.name)}" title="Delete this net (unwires its ${n.pins.length} pins)">×</button>
    </div>`).join('')}</div>`;
  if (keep) { const i = el.querySelector(`input[data-net="${CSS.escape(keep)}"]`); if (i) i.focus(); }
}

export function initNets() {
  const el = $('nets');
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.net) {
      const from = t.dataset.net, to = t.value.trim();
      if (from === to) return;
      let err = null;
      edit(p => { err = renameNet(p, from, to); });        // an invalid name changes nothing -> no history
      if (err) { toast(err, true); t.value = from; return; }
      if (S.pinnedNet === from) { S.pinnedNet = to; emit('all'); }
    }
    if (t.dataset.netcls) { const name = t.dataset.netcls, v = t.value; edit(p => { const n = p.nets.find(x => x.name === name); if (n) n.class = v; }, { route: false }); }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.net) e.target.blur(); });
  el.addEventListener('click', e => {
    const del = e.target.closest('[data-netdel]');
    if (del) { const name = del.dataset.netdel; edit(p => { p.nets = p.nets.filter(n => n.name !== name); }); toast(`Deleted net ${name}`); return; }
    const c = e.target.closest('[data-cmd3]');
    if (c) { cmd(c.dataset.cmd3); return; }
    const row = e.target.closest('[data-netrow]');
    if (row && !e.target.closest('input,select,button')) { S.pinnedNet = S.pinnedNet === row.dataset.netrow ? null : row.dataset.netrow; emit('all'); }
  });
  el.addEventListener('mouseover', e => {
    const row = e.target.closest('[data-netrow]'), name = row ? row.dataset.netrow : null;
    if (name !== S.hoverNet) { S.hoverNet = name; emit('hover+board'); }
  });
  el.addEventListener('mouseleave', () => { if (S.hoverNet) { S.hoverNet = null; emit('hover+board'); } });
}

/* ============================== wire list ============================== */
export function renderWireList() {
  const rows = wireRows(S.routing), cut = cutList(rows, S.project);
  const done = rows.filter(r => S.done.has(rowKey(r))).length;
  $('bottomHead').innerHTML = `<button class="btn ghost icon" data-wl="toggle" title="Show / hide the wire list">${S.bottomOpen ? '▾' : '▸'}</button>
    <b>Wire list</b><span class="muted small">${rows.length} wires · ~${totalLengthCm(S.routing)} cm · ${done}/${rows.length} done</span>
    <span class="spacer"></span>
    <span class="muted small">Holes are counted from the <b>front-left</b> — on the solder side, column 1 is on your right.</span>
    <button class="btn ghost tiny" data-wl="clear" ${done ? '' : 'disabled'}>Clear ticks</button>
    <button class="btn tiny" data-cmd4="exportCSV">CSV</button>`;
  if (!S.bottomOpen) { $('wireList').innerHTML = ''; return; }
  const wl = $('wireList'), top = wl.scrollTop;
  wl.innerHTML = (cut.length ? `<div class="cut">${cut.map(c => `<span><span class="sw" style="background:${netClass(S.project, c.cls).color}"></span>${esc(c.label)}: ${c.count} × (${c.lengths.slice(0, 6).join(', ')}${c.lengths.length > 6 ? ', …' : ''} mm)</span>`).join('')}<span class="dim">cut lengths include 10 mm for stripping</span></div>` : '') +
    `<table class="wl"><tr><th></th><th>#</th><th>Net</th><th>From</th><th>To</th><th>Length</th></tr>` +
    rows.map(r => {
      const k = rowKey(r), isDone = S.done.has(k);
      return `<tr data-net="${esc(r.net)}" class="${S.pinnedNet === r.net ? 'hi' : ''} ${isDone ? 'done' : ''}">
        <td><input type="checkbox" data-done="${esc(k)}" ${isDone ? 'checked' : ''} title="Tick off at the bench" /></td>
        <td>${r.n}</td><td><span class="sw" style="background:${netClass(S.project, r.cls).color}"></span>${esc(r.net)}${r.unrouted ? ' <span class="badge warn">unrouted</span>' : ''}${r.lead ? ' <span class="badge">lead</span>' : ''}</td>
        <td class="mono">${esc(r.from.part)} ${esc(r.from.pin)} · ${esc(r.from.hole)}</td>
        <td class="mono">${esc(r.to.part)} ${esc(r.to.pin)} · ${esc(r.to.hole)}</td>
        <td>${r.lengthMm} mm</td></tr>`;
    }).join('') + '</table>';
  wl.scrollTop = top;
}
const rowKey = r => [r.net, r.from.ref, r.to.ref].join('|');

export function initWireList() {
  const head = $('bottomHead'), body = $('wireList');
  head.addEventListener('click', e => {
    const b = e.target.closest('[data-wl]'), c = e.target.closest('[data-cmd4]');
    if (c) return cmd(c.dataset.cmd4);
    if (!b) return;
    if (b.dataset.wl === 'toggle') { S.bottomOpen = !S.bottomOpen; savePrefs(); applyBottom(); renderWireList(); }
    if (b.dataset.wl === 'clear') { S.done.clear(); renderWireList(); }
  });
  body.addEventListener('click', e => {
    const cb = e.target.closest('[data-done]');
    if (cb) { cb.checked ? S.done.add(cb.dataset.done) : S.done.delete(cb.dataset.done); renderWireList(); return; }
    const tr = e.target.closest('tr[data-net]');
    if (tr) { S.pinnedNet = S.pinnedNet === tr.dataset.net ? null : tr.dataset.net; emit('all'); }
  });
  // drag the top edge of the wire list to resize it
  const rz = $('resizer');
  rz.addEventListener('pointerdown', e => {
    rz.setPointerCapture(e.pointerId);
    const startY = e.clientY, startH = $('bottom').getBoundingClientRect().height;
    const move = ev => { const h = Math.max(90, Math.min(window.innerHeight - 260, startH - (ev.clientY - startY))); document.documentElement.style.setProperty('--bottom-h', h + 'px'); };
    const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); };
    rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
  });
}
export function applyBottom() { $('app').classList.toggle('no-bottom', !S.bottomOpen); }

/* ============================== status ============================== */
export function renderStatus() {
  $('statusHover').textContent = S.hover || (S.tool === 'connect' ? 'Connect: click a pin' : 'Hover a pin to see its net and hole');
  const w = S.routing.wires.length;
  $('statusInfo').textContent = `${S.project.parts.length} parts · ${S.project.nets.length} nets · ${w} wires · ` +
    (S.routing.mode === 'routed' ? `routed in ${S.routeMs.toFixed(0)} ms` : 'ratsnest') + ` · zoom ${S.zoom}px/hole`;
}

