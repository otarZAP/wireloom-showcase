// The wire list: the bench checklist that comes out of a routed project.

import { holeLabel } from './geometry.js';

const MM_PER_HOLE = 2.54;

/** One row per wire: { n, net, cls, from, to, lengthMm } with readable endpoints. */
export function wireRows(routing) {
  const end = p => ({
    part: p.part.label || p.part.id, pin: p.name, ref: p.ref,
    hole: p.offboard ? 'lead' : holeLabel(p.x, p.y),
  });
  return routing.wires.map((w, i) => ({
    n: i + 1, net: w.net, cls: w.cls, from: end(w.a), to: end(w.b),
    lengthMm: Math.round(w.len * MM_PER_HOLE), routed: w.routed, lead: w.lead, unrouted: w.unrouted,
  }));
}

export const totalLengthCm = routing => Math.round(routing.wires.reduce((s, w) => s + w.len, 0) * MM_PER_HOLE / 10);

/** CSV for spreadsheets / printing (one wire per line). */
export function wireListCSV(rows) {
  const q = s => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  const head = ['#', 'Net', 'From part', 'From pin', 'From hole', 'To part', 'To pin', 'To hole', 'Length (mm)'];
  return [head.join(','), ...rows.map(r =>
    [r.n, r.net, r.from.part, r.from.pin, r.from.hole, r.to.part, r.to.pin, r.to.hole, r.lengthMm].map(q).join(','))].join('\n') + '\n';
}

/** A per-colour cut list: how many wires of each net class, and their lengths (+10 mm strip allowance). */
export function cutList(rows, project) {
  const by = new Map();
  for (const r of rows) {
    if (r.lead) continue;
    if (!by.has(r.cls)) by.set(r.cls, []);
    by.get(r.cls).push(r.lengthMm + 10);
  }
  return [...by.entries()].map(([cls, lens]) => ({
    cls, label: ((project.netClasses || {})[cls] || {}).label || cls,
    count: lens.length, lengths: lens.sort((a, b) => b - a), totalMm: lens.reduce((s, x) => s + x, 0),
  })).sort((a, b) => b.totalMm - a.totalMm);
}
