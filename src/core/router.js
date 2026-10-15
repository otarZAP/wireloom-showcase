// Point-to-point wire router for perfboard.
//
// Each connection is routed with Dijkstra over (hole, heading) states, so turns can be
// charged. Costs: 1 per hole, plus `turn` per bend, `soft` under a back-side module
// body, `antennaZone` through a 2.4 GHz antenna's end, `cross` over another net's wire,
// and `hop` to pass over another pin. Pins aren't walls: insulated wire can arc over a
// neighbouring joint (that's how the inner row of a 2x4 header gets reached), it just
// costs. Connections are routed shortest-first, one at a time (no rip-up yet).

import { modOf, rules } from './project.js';
import { placedSize, localToBoard } from './geometry.js';
import { resolveNets, mst, pinMap } from './netlist.js';

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, rk = K[0], rv = V[0], lk = K.pop(), lv = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) { let l = 2 * i + 1; if (l >= n) break; const r = l + 1; if (r < n && K[r] < K[l]) l = r;
                 if (K[l] >= lk) break; K[i] = K[l]; V[i] = V[l]; i = l; }
      K[i] = lk; V[i] = lv;
    }
    return [rk, rv];
  }
}

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

function route(a, b, ni, G) {
  const { cols, rows, pinNet, cost, used, c } = G;
  const N = cols * rows, s = a.y * cols + a.x, t = b.y * cols + b.x;
  const dist = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1), h = new Heap();
  for (let d = 0; d < 4; d++) { dist[s * 4 + d] = 0; h.push(0, s * 4 + d); }
  while (h.size) {
    const [du, u] = h.pop();
    if (du > dist[u]) continue;
    const cell = u >> 2, dir = u & 3;
    if (cell === t) {
      const out = [];
      for (let x = u; x >= 0; x = prev[x]) out.push(x >> 2);
      out.reverse();
      return out.map(k => [k % cols, (k / cols) | 0]);
    }
    const x = cell % cols, y = (cell / cols) | 0;
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DX[nd], ny = y + DY[nd];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const k = ny * cols + nx, pn = pinNet[k];
      let w = 1 + cost[k] + (nd !== dir ? c.turn : 0);
      if (pn !== -1 && pn !== ni && k !== t) w += c.hop;
      if (used[k] >= 0 && used[k] !== ni) w += c.cross;
      const v = k * 4 + nd, nd2 = du + w;
      if (nd2 < dist[v]) { dist[v] = nd2; prev[v] = u; h.push(nd2, v); }
    }
  }
  return null;
}

/** Collapse a hole-by-hole path to its corner points. */
export function corners(cells) {
  if (cells.length < 3) return cells.slice();
  const o = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], c = cells[i + 1];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) o.push(b);
  }
  o.push(cells[cells.length - 1]);
  return o;
}

const is24 = mod => !!(mod && mod.antenna && /2\.4/.test(mod.antenna.band || '') && !mod.offboard);

/**
 * Route a whole project.
 * mode: 'routed' (grid router) or 'ratsnest' (straight lines; cheap, used while dragging).
 * Returns { wires, pins (Map "x,y" -> pins), netOfHole (Map "x,y" -> net index), nets }.
 */
export function routeProject(project, mode = 'routed') {
  const { cols, rows } = project.board, N = cols * rows;
  const inGrid = p => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
  const R = rules(project), c = R.router;
  const pins = pinMap(project);
  const nets = resolveNets(project);
  const netOfHole = new Map();
  const pinNet = new Int16Array(N).fill(-1);
  pins.forEach(ps => { const p = ps[0]; if (inGrid(p)) pinNet[p.y * cols + p.x] = -2; });   // every pin owns its hole
  nets.forEach((nt, ni) => nt.nodes.forEach(p => {
    if (p.offboard) return;
    netOfHole.set(p.x + ',' + p.y, ni);
    if (inGrid(p)) pinNet[p.y * cols + p.x] = ni;
  }));

  const cost = new Uint8Array(N);
  const raise = (x, y, v) => { if (x >= 0 && y >= 0 && x < cols && y < rows) { const k = y * cols + x; cost[k] = Math.max(cost[k], v); } };
  for (const part of project.parts) {
    const mod = modOf(project, part);
    if (!mod || mod.offboard) continue;
    const [w, h] = placedSize(part, mod);
    if (part.side === 'back') for (let y = part.y; y < part.y + h; y++) for (let x = part.x; x < part.x + w; x++) raise(x, y, c.soft);
    if (is24(mod)) {                                     // the 3 hole-rows at the antenna end
      const e = mod.antenna.edge, { w: mw, h: mh } = mod.size;
      for (let i = 0; i < 3; i++) for (let j = 0; j < (e === 'top' || e === 'bottom' ? mw : mh); j++) {
        const [u, v] = e === 'top' ? [j, i] : e === 'bottom' ? [j, mh - 1 - i] : e === 'left' ? [i, j] : [mw - 1 - i, j];
        const [bx, by] = localToBoard(part, mod, u + 0.5, v + 0.5);
        raise(Math.floor(bx), Math.floor(by), c.soft + c.antennaZone);
      }
    }
  }

  const used = new Int16Array(N).fill(-1), jobs = [];
  nets.forEach((nt, ni) => mst(nt.nodes).forEach(([a, b]) =>
    jobs.push({ ni, nt, a, b, d: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) })));
  jobs.sort((x, y) => x.d - y.d);

  const G = { cols, rows, pinNet, cost, used, c }, wires = [];
  for (const j of jobs) {
    const lead = j.a.offboard || j.b.offboard;
    const w = { net: j.nt.name, cls: j.nt.cls, ni: j.ni, a: j.a, b: j.b, lead, routed: false, unrouted: false,
                cells: null, path: null, len: 0 };
    if (lead) {
      w.path = [[j.a.x, j.a.y], [j.b.x, j.b.y]]; w.len = Math.hypot(j.a.x - j.b.x, j.a.y - j.b.y);
    } else if (mode !== 'routed' || !inGrid(j.a) || !inGrid(j.b)) {
      w.path = [[j.a.x, j.a.y], [j.b.x, j.b.y]]; w.len = j.d; w.unrouted = mode === 'routed';
    } else {
      const cells = route(j.a, j.b, j.ni, G);
      if (cells) {
        w.cells = cells; w.path = corners(cells); w.routed = true; w.len = cells.length - 1;
        for (const [x, y] of cells) { const k = y * cols + x; if (used[k] < 0) used[k] = j.ni; }
      } else { w.path = [[j.a.x, j.a.y], [j.b.x, j.b.y]]; w.len = j.d; w.unrouted = true; }
    }
    wires.push(w);
  }
  wires.sort((x, y) => x.ni - y.ni || x.len - y.len);
  return { wires, pins, netOfHole, nets, mode };
}
