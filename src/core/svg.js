// One SVG renderer for both the live editor and exported drawings, so what you see is
// exactly what you export. Views:
//   both  — x-ray from the front: front parts solid, back parts dim + hatched, and a
//           dashed outline for any back part hidden under a front one.
//   front — what you see holding the board: front parts solid, back parts dashed.
//   back  — the solder side, MIRRORED as you'll see it flipped: back parts solid,
//           front parts dashed, wires and pins on top.

import { modOf, netClass, rules } from './project.js';
import { placedEdge, antennaPoint, partRect, pointInRect, partPins } from './geometry.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const is24 = mod => !!(mod && mod.antenna && /2\.4/.test(mod.antenna.band || '') && !mod.offboard);
const FONT = "-apple-system,'Segoe UI',Roboto,sans-serif";
const DRAW_ORDER = ['gnd', 'vcc', 'batneg', 'vbat', 'btn', 'uart', 'i2c', 'ctrl', 'ce', 'cs', 'miso', 'mosi', 'sck', 'signal'];

/** Pixel layout of a rendered board (the UI uses this to turn a click into a hole). */
export function layout(project, opts = {}) {
  const P = opts.pitch || 11, M = opts.margin ?? 30, T = opts.title ? 26 : 0;
  const W = project.board.cols * P, H = project.board.rows * P;
  return { P, M, T, W, H, width: W + 2 * M, height: H + 2 * M + T, ox: M, oy: M + T, mirrored: opts.view === 'back' };
}

/** Pixel -> hole, inverting the view's mirroring. Returns null outside the board. */
export function holeAt(project, L, px, py) {
  const dx = Math.floor((px - L.ox) / L.P), y = Math.floor((py - L.oy) / L.P);
  const x = L.mirrored ? project.board.cols - 1 - dx : dx;
  if (x < 0 || y < 0 || x >= project.board.cols || y >= project.board.rows) return null;
  return [x, y];
}

/**
 * @param opts { view, pitch, title, interactive, wires: 'show'|'off', highlightNet,
 *               selected, pendingPin, margin }
 */
export function renderBoard(project, routing, analysis, opts = {}) {
  const view = opts.view || 'both', mir = view === 'back', L = layout(project, opts), P = L.P;
  const { cols, rows } = project.board, I = !!opts.interactive, R = rules(project);
  const X = x => (mir ? cols - x : x) * P, Y = y => y * P;
  const box = r => ({ x: mir ? X(r.x + r.w) : X(r.x), y: Y(r.y), w: r.w * P, h: r.h * P });
  const fs = Math.max(7, Math.round(9 * P / 11 * 10) / 10), small = Math.max(6, fs * 0.82);
  const flagged = (analysis && analysis.flagged) || new Set();
  const hi = opts.highlightNet || null;
  const items = project.parts.map(p => ({ p, m: modOf(project, p) })).filter(o => o.m);
  const onFace = o => view === 'both' ? o.p.side === 'front' : o.p.side === view;
  const id = opts.idPrefix || 'wl';

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" font-family="${FONT}">`;
  s += `<defs><pattern id="${id}-holes" width="${P}" height="${P}" patternUnits="userSpaceOnUse">` +
       `<circle cx="${P / 2}" cy="${P / 2}" r="${Math.max(0.9, P * 0.11)}" fill="#1d3a28"/></pattern>` +
       `<pattern id="${id}-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
       `<rect width="4" height="8" fill="#ffffff" fill-opacity="0.05"/></pattern></defs>`;
  if (opts.title) s += `<text x="${L.width / 2}" y="17" text-anchor="middle" fill="#e6edf3" font-size="14" font-weight="700">${esc(opts.title)}</text>`;
  s += `<g transform="translate(${L.ox},${L.oy})">`;
  s += `<rect width="${L.W}" height="${L.H}" rx="5" fill="#0d1f16" stroke="#2e5a3c" stroke-width="1.5"/>` +
       `<rect width="${L.W}" height="${L.H}" fill="url(#${id}-holes)" pointer-events="none"/>`;

  // rulers: physical labels, 1-based from the front-left corner (they reverse when mirrored)
  for (let x = 0; x < cols; x++) if (x === 0 || (x + 1) % 5 === 0)
    s += `<text x="${X(x + 0.5)}" y="-8" text-anchor="middle" fill="#6e7681" font-size="${small}">${x + 1}</text>`;
  for (let y = 0; y < rows; y++) if (y === 0 || (y + 1) % 5 === 0)
    s += `<text x="-7" y="${Y(y + 0.5) + small / 3}" text-anchor="end" fill="#6e7681" font-size="${small}">${y + 1}</text>`;

  const label = (o, b, style) => {
    const suffix = style === 'dashed' ? (o.m.offboard ? ' (in case)' : ` (${o.p.side})`) : style === 'ghost' ? ' (back)' : '';
    const text = (o.p.label || o.m.name) + suffix;
    if (style === 'ghost') {               // x-ray outline: tuck the label in the corner, clear of the part on top
      if (b.w < text.length * small * 0.6 + 8) return '';
      return `<text x="${b.x + 4}" y="${b.y + small + 3}" fill="#c9d1d9" font-size="${small}" font-weight="600" pointer-events="none">${esc(text)}</text>`;
    }
    if (b.w < text.length * fs * 0.58) return '';
    const fill = style === 'solid' || style === 'under' ? '#e6edf3' : '#9aa4b2';
    let t = `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" text-anchor="middle" fill="${fill}" font-size="${fs}" font-weight="600" pointer-events="none">${esc(text)}</text>`;
    if ((style === 'solid' || style === 'under') && o.m.note && b.w >= o.m.note.length * small * 0.56 && b.h >= fs * 3)
      t += `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 1.25}" text-anchor="middle" fill="#8b949e" font-size="${small}" pointer-events="none">${esc(o.m.note)}</text>`;
    return t;
  };
  const antStrip = (o, b) => {
    if (!o.m.antenna) return '';
    let e = placedEdge(o.p, o.m.antenna.edge || 'top');
    if (mir && (e === 'left' || e === 'right')) e = e === 'left' ? 'right' : 'left';
    const t = Math.max(2, P * 0.27);
    const r = e === 'top' ? [b.x + b.w * .15, b.y, b.w * .7, t] : e === 'bottom' ? [b.x + b.w * .15, b.y + b.h - t, b.w * .7, t]
            : e === 'right' ? [b.x + b.w - t, b.y + b.h * .15, t, b.h * .7] : [b.x, b.y + b.h * .15, t, b.h * .7];
    return `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="#f0883e" pointer-events="none"/>`;
  };
  const drawPart = (o, style, noLabel = false) => {
    const b = box(partRect(o.p, o.m)), sel = opts.selected === o.p.id, bad = flagged.has(o.p.id);
    const hit = I && style !== 'dashed' && style !== 'ghost' ? ` data-part="${esc(o.p.id)}" class="part"` : ' pointer-events="none"';
    let g = `<g${hit}>`;
    if (style === 'solid')
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${o.m.color || '#2b313b'}" stroke="#5a6372" stroke-width="1.2"/>`;
    else if (style === 'under')
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${o.m.color || '#2b313b'}" fill-opacity="0.55" stroke="#4a5262" stroke-width="1.1"/>` +
           `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="url(#${id}-hatch)"/>`;
    else if (style === 'offboard')
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="5" fill="#f85149" fill-opacity="0.06" stroke="#f85149" stroke-opacity="0.7" stroke-dasharray="6 3" stroke-width="1.3"/>`;
    else
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="none" stroke="${style === 'ghost' ? '#c9d1d9' : '#8b949e'}" stroke-opacity="0.75" stroke-dasharray="4 3" stroke-width="1.1"/>`;
    if (style !== 'dashed' && style !== 'ghost') g += antStrip(o, b);
    if (sel) g += `<rect x="${b.x - 2}" y="${b.y - 2}" width="${b.w + 4}" height="${b.h + 4}" rx="4" fill="none" stroke="#58a6ff" stroke-width="2" pointer-events="none"/>`;
    if (bad && style !== 'ghost') g += `<rect x="${b.x - 1}" y="${b.y - 1}" width="${b.w + 2}" height="${b.h + 2}" rx="4" fill="none" stroke="#f85149" stroke-width="1.6" stroke-dasharray="5 3" pointer-events="none"/>`;
    if (!noLabel) g += label(o, b, style === 'offboard' ? 'dashed' : style);
    return g + '</g>';
  };

  // -------- parts, back to front --------
  const solidOnFace = items.filter(o => onFace(o) && !o.m.offboard);
  if (view === 'both') {
    for (const o of items) if (o.p.side === 'back' && !o.m.offboard) s += drawPart(o, 'under');
    for (const o of items) if (o.m.offboard) s += drawPart(o, 'offboard');
    for (const o of solidOnFace) s += drawPart(o, 'solid');
    for (const o of items) {                         // x-ray outline where a back part is hidden
      if (o.p.side !== 'back' || o.m.offboard) continue;
      const r = partRect(o.p, o.m), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      if (solidOnFace.some(f => pointInRect(partRect(f.p, f.m), cx, cy))) s += drawPart(o, 'ghost');
    }
  } else {
    for (const o of items) {                         // other face first, so solid parts hide it
      if (onFace(o) && !o.m.offboard) continue;
      if (o.m.offboard) { if (view === 'front') s += drawPart(o, 'dashed'); continue; }
      const r = partRect(o.p, o.m), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      s += drawPart(o, 'dashed', solidOnFace.some(f => pointInRect(partRect(f.p, f.m), cx, cy)));
    }
    for (const o of solidOnFace) s += drawPart(o, 'solid');
    if (view === 'back') for (const o of items) if (o.m.offboard) s += drawPart(o, 'offboard');
  }

  // -------- antenna keep-out rings --------
  if (view !== 'front') for (const o of items) {
    if (!is24(o.m)) continue;
    const [ax, ay] = antennaPoint(o.p, o.m), bad = flagged.has(o.p.id);
    s += `<circle cx="${X(ax)}" cy="${Y(ay)}" r="${R.antennaKeep * P}" fill="${bad ? '#f85149' : 'none'}" fill-opacity="0.07" ` +
         `stroke="${bad ? '#f85149' : '#f0883e'}" stroke-opacity="0.55" stroke-dasharray="3 3" pointer-events="none"/>`;
  }

  // -------- wires + pins (they live on the back; not drawn in the front view) --------
  if (view !== 'front' && routing) {
    const pts = path => path.map(([x, y]) => X(x + 0.5).toFixed(1) + ',' + Y(y + 0.5).toFixed(1)).join(' ');
    const op = w => (hi && w.net !== hi) ? 0.12 : 0.95;
    const sw = Math.max(1.6, P * 0.2);
    if (opts.wires !== 'off') {
      const ws = routing.wires.filter(w => w.path).sort((a, b) => DRAW_ORDER.indexOf(a.cls) - DRAW_ORDER.indexOf(b.cls));
      for (const w of ws) if (w.routed)
        s += `<polyline points="${pts(w.path)}" fill="none" stroke="#0d1117" stroke-width="${sw * 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${op(w) > .5 ? .7 : .1}" pointer-events="none"/>`;
      for (const w of ws) {
        const col = netClass(project, w.cls).color;
        s += w.routed
          ? `<polyline points="${pts(w.path)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" opacity="${op(w)}" pointer-events="none"/>`
          : `<polyline points="${pts(w.path)}" fill="none" stroke="${w.unrouted ? '#f85149' : col}" stroke-width="${w.lead ? sw * .9 : sw * .65}" stroke-dasharray="${w.lead ? '5 3' : '2 3'}" opacity="${op(w)}" pointer-events="none"/>`;
      }
    }
    const pr = Math.max(1.8, P * 0.24);
    routing.pins.forEach((ps, k) => {
      const p = ps[0], ni = routing.netOfHole.get(k), net = ni !== undefined ? routing.nets[ni] : null;
      const dim = hi && (!net || net.name !== hi), pend = opts.pendingPin && ps.some(q => q.ref === opts.pendingPin);
      const fill = ps.length > 1 ? '#f85149' : net ? '#d9a441' : '#5a4c2e';
      s += `<circle cx="${X(p.x + 0.5).toFixed(1)}" cy="${Y(p.y + 0.5).toFixed(1)}" r="${(net ? pr : pr * .7).toFixed(2)}" fill="${fill}" ` +
           `stroke="${pend ? '#ffffff' : net ? netClass(project, net.cls).color : 'none'}" stroke-width="${pend ? 2.5 : 1.2}" opacity="${dim ? 0.3 : 1}"` +
           (I ? ` data-pin="${esc(p.ref)}" class="pad"` : ' pointer-events="none"') + '/>';
    });
    for (const o of items) if (o.m.offboard) for (const pp of partPins(o.p, o.m)) {   // battery leads etc.
      const ref = o.p.id + ':' + pp.name;
      s += `<circle cx="${X(pp.x + 0.5).toFixed(1)}" cy="${Y(pp.y + 0.5).toFixed(1)}" r="${pr.toFixed(2)}" fill="#0d1117" stroke="#f85149" ` +
           `stroke-width="${opts.pendingPin === ref ? 2.5 : 1.2}"` + (I ? ` data-pin="${esc(ref)}" class="pad"` : ' pointer-events="none"') + '/>';
    }
  }
  return s + '</g></svg>';
}
