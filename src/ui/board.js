// The board view: renders the core's SVG and turns pointer input into edits.

import { renderBoard, layout, holeAt, partById, modOf, fitPart, connect, disconnect, allPins, holeLabel, netOfPin } from '../core/index.js';
import { S, edit, emit, reroute, snapshot, pushUndo, autosave } from './store.js';
import { toast } from './dialogs.js';

const host = () => document.getElementById('boardHost');
let L = null;           // layout of the last render (pixel <-> hole)
let drag = null;        // { id, mx, my, ox, oy, before, moved }

export function renderBoardView() {
  const h = host();
  const opts = { view: S.view, pitch: S.zoom, interactive: true, wires: S.wireMode === 'off' ? 'off' : 'show',
                 highlightNet: S.hoverNet || S.pinnedNet, selected: S.selected, pendingPin: S.pendingPin, idPrefix: 'live' };
  L = layout(S.project, opts);
  h.innerHTML = renderBoard(S.project, S.routing, S.analysis, opts);
  h.dataset.tool = S.tool;
  const hint = document.getElementById('toolHint');
  hint.textContent = S.tool === 'connect'
    ? (S.pendingPin ? `Connecting from ${S.pendingPin} — click the other pin (Shift-click to keep chaining, Esc to stop)` : 'Connect: click a pin, then the pin to wire it to')
    : S.tool === 'disconnect' ? 'Disconnect: click a pin to take it out of its net' : '';
}

/** Pointer position in SVG user units (robust to CSS scaling). */
function local(e) {
  const svg = host().querySelector('svg');
  const r = svg.getBoundingClientRect();
  return [(e.clientX - r.left) * (L.width / r.width), (e.clientY - r.top) * (L.height / r.height)];
}

/** Pins in a hole, on-board first, then off-board leads. */
function pinsAt(x, y) {
  const on = S.routing.pins.get(x + ',' + y);
  if (on) return on;
  const off = allPins(S.project).filter(p => p.offboard && p.x === x && p.y === y);
  return off.length ? off : null;
}

function describe(ps, hole) {
  const p = ps[0], net = netOfPin(S.project, p.ref);
  let t = `${p.part.label || p.part.id} · ${p.name} · ${net ? 'net ' + net.name : 'not connected'} · ${p.offboard ? 'lead' : holeLabel(...hole)}`;
  if (ps.length > 1) t += `  ⚠ also ${ps.slice(1).map(q => (q.part.label || q.part.id) + ' ' + q.name).join(', ')} in this hole`;
  return { text: t, net: net ? net.name : null };
}

function hover(e) {
  const [mx, my] = local(e);
  const hole = holeAt(S.project, L, mx, my);
  const ps = hole && S.view !== 'front' ? pinsAt(hole[0], hole[1]) : null;
  const before = S.hoverNet;
  if (ps) { const d = describe(ps, hole); S.hover = d.text; S.hoverNet = d.net; }
  else { S.hover = hole ? holeLabel(hole[0], hole[1]) : null; S.hoverNet = null; }
  emit(before !== S.hoverNet ? 'hover+board' : 'hover');
}

function onConnectClick(ref, shift) {
  if (!S.pendingPin) { S.pendingPin = ref; emit('board'); return; }
  if (S.pendingPin === ref) { S.pendingPin = null; emit('board'); return; }
  const a = S.pendingPin;
  const net = edit(p => connect(p, a, ref));
  S.pendingPin = shift ? ref : null;
  toast(`Wired ${a} → ${ref}${net ? ' (net ' + net.name + ')' : ''}`);
  emit('board');
}

export function initBoard() {
  const h = host();
  h.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const pad = e.target.closest('[data-pin]'), part = e.target.closest('[data-part]');
    if (S.tool === 'connect') { if (pad) onConnectClick(pad.dataset.pin, e.shiftKey); else if (!part) { S.pendingPin = null; emit('board'); } if (pad) return; }
    if (S.tool === 'disconnect') {
      if (pad) {
        const ref = pad.dataset.pin;
        if (!netOfPin(S.project, ref)) { toast(`${ref} isn't connected`); return; }
        edit(p => disconnect(p, ref)); toast(`Disconnected ${ref}`);
      }
      return;
    }
    const id = part ? part.dataset.part : pad ? pad.dataset.pin.split(':')[0] : null;
    if (!id) { if (S.selected || S.pendingPin) { S.selected = null; S.pendingPin = null; emit('all'); } return; }
    const p = partById(S.project, id);
    if (!p) return;
    const [mx, my] = local(e);
    S.selected = id;
    drag = { id, mx, my, ox: p.x, oy: p.y, before: snapshot(), moved: false };
    h.setPointerCapture(e.pointerId);
    emit('all');
  });

  h.addEventListener('pointermove', e => {
    if (!drag) { hover(e); return; }
    const [mx, my] = local(e);
    const p = partById(S.project, drag.id), m = modOf(S.project, p);
    let dx = Math.round((mx - drag.mx) / L.P);
    const dy = Math.round((my - drag.my) / L.P);
    if (L.mirrored) dx = -dx;                            // solder side is mirrored
    const nx = drag.ox + dx, ny = drag.oy + dy;
    if (nx === p.x && ny === p.y && drag.moved) return;
    p.x = nx; p.y = ny; fitPart(p, m, S.project.board);
    if (!drag.moved && p.x === drag.ox && p.y === drag.oy) return;
    drag.moved = true; S.dragging = true;
    reroute('ratsnest');                                 // cheap straight lines while moving
    emit('board');
  });

  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; S.dragging = false;
    if (d.moved && snapshot() !== d.before) { pushUndo(d.before); S.dirty = true; autosave(); }
    reroute(); emit('all');
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  h.addEventListener('pointerleave', () => { if (!drag && (S.hover || S.hoverNet)) { const b = S.hoverNet; S.hover = null; S.hoverNet = null; emit(b ? 'hover+board' : 'hover'); } });

  h.addEventListener('dblclick', e => {
    const part = e.target.closest('[data-part]');
    if (part) emit('focus-label');
  });

  document.getElementById('center').addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('wl-cmd', { detail: e.deltaY < 0 ? 'zoomIn' : 'zoomOut' }));
  }, { passive: false });
}

/** Zoom that fits the whole board in the centre pane. */
export function fitZoom() {
  const c = document.getElementById('center');
  const { cols, rows } = S.project.board;
  const z = Math.min((c.clientWidth - 48 - 60) / cols, (c.clientHeight - 48 - 60) / rows);
  return Math.max(6, Math.min(30, Math.floor(z)));
}

/** Nudge the selected part by whole holes (mirror-aware). */
export function nudge(dx, dy) {
  const p = S.selected && partById(S.project, S.selected);
  if (!p) return;
  edit(proj => { const q = partById(proj, p.id); q.x += S.view === 'back' ? -dx : dx; q.y += dy; fitPart(q, modOf(proj, q), proj.board); });
}

export { L as lastLayout };
