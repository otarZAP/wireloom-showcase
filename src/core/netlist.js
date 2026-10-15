// Turn the project's nets ("part:pin" references) into placed pins on the board,
// and decide which pins of each net get joined directly (a minimum spanning tree).

import { partPins } from './geometry.js';
import { modOf } from './project.js';

/** All placed pins of all parts. Off-board parts (e.g. a battery in the case) included, flagged. */
export function allPins(project) {
  const out = [];
  for (const part of project.parts) {
    const mod = modOf(project, part);
    if (!mod) continue;
    for (const p of partPins(part, mod)) out.push({ ...p, ref: part.id + ':' + p.name, offboard: !!mod.offboard });
  }
  return out;
}

/** Map "x,y" -> [pins in that hole] for on-board pins. More than one = a collision. */
export function pinMap(project) {
  const m = new Map();
  for (const p of allPins(project)) {
    if (p.offboard) continue;
    const k = p.x + ',' + p.y;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p);
  }
  return m;
}

/**
 * Resolve each net to concrete pins. A module may have several pins with the same name
 * (an ESP32's four GNDs): those are internally common, so the one nearest the rest of
 * the net is used.
 */
export function resolveNets(project) {
  const byPart = new Map();
  for (const p of allPins(project)) {
    if (!byPart.has(p.part.id)) byPart.set(p.part.id, []);
    byPart.get(p.part.id).push(p);
  }
  return project.nets.map(net => {
    const groups = net.pins.map(ref => {
      const [pid, pin] = ref.split(':');
      return (byPart.get(pid) || []).filter(p => p.name === pin);
    });
    const fixed = groups.filter(g => g.length === 1).map(g => g[0]);
    const cx = fixed.reduce((s, p) => s + p.x, 0) / (fixed.length || 1);
    const cy = fixed.reduce((s, p) => s + p.y, 0) / (fixed.length || 1);
    const d = p => Math.abs(p.x - cx) + Math.abs(p.y - cy);
    const nodes = groups.filter(g => g.length).map(g => g.length === 1 ? g[0] : g.reduce((b, p) => d(p) < d(b) ? p : b));
    const missing = net.pins.filter((_, i) => !groups[i].length);
    return { name: net.name, cls: net.class || 'signal', nodes, missing };
  });
}

/** Prim's minimum spanning tree with Manhattan distance -> list of [a, b] pin pairs. */
export function mst(nodes) {
  const n = nodes.length, inTree = Array(n).fill(false), best = Array(n).fill(Infinity), parent = Array(n).fill(-1), edges = [];
  if (!n) return edges;
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (parent[u] >= 0) edges.push([nodes[parent[u]], nodes[u]]);
    for (let v = 0; v < n; v++) if (!inTree[v]) {
      const dd = Math.abs(nodes[u].x - nodes[v].x) + Math.abs(nodes[u].y - nodes[v].y);
      if (dd < best[v]) { best[v] = dd; parent[v] = u; }
    }
  }
  return edges;
}
