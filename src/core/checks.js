// Design checks: things that are physically wrong or RF-unwise, found from geometry alone.

import { modOf, rules } from './project.js';
import { antennaPoint, partRect, circleHitsRect, tooBig } from './geometry.js';

const is24 = mod => !!(mod && mod.antenna && /2\.4/.test(mod.antenna.band || '') && !mod.offboard);

/**
 * @returns {{
 *   antennaPairs: Array<[part, part, number]>,  // 2.4 GHz antennas closer than antennaMinSep (holes)
 *   metalNearAntenna: Array<[part, part]>,      // [antenna part, metal part] inside the keep-out
 *   collisions: Array<Array<pin>>,               // two or more pins in one hole
 *   tooBig: Array<part>,                         // parts that can't fit the board either way round
 *   unrouted: Array<wire>,                       // connections the router couldn't place
 *   missing: Array<{net, ref}>,                  // net references to pins that don't exist
 *   flagged: Set<string>,                        // part ids to outline in red
 * }}
 */
export function analyse(project, routing) {
  const R = rules(project), flagged = new Set();
  const ants = project.parts.filter(p => is24(modOf(project, p)));
  const antennaPairs = [], metalNearAntenna = [];
  for (let i = 0; i < ants.length; i++) for (let j = i + 1; j < ants.length; j++) {
    const a = antennaPoint(ants[i], modOf(project, ants[i])), b = antennaPoint(ants[j], modOf(project, ants[j]));
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < R.antennaMinSep) { antennaPairs.push([ants[i], ants[j], d]); flagged.add(ants[i].id); flagged.add(ants[j].id); }
  }
  for (const a of ants) {
    const [ax, ay] = antennaPoint(a, modOf(project, a));
    for (const m of project.parts) {
      const mm = modOf(project, m);
      if (m === a || !mm || !mm.metal) continue;
      if (circleHitsRect(ax, ay, R.antennaKeep, partRect(m, mm))) { metalNearAntenna.push([a, m]); flagged.add(a.id); }
    }
  }
  const collisions = [];
  (routing ? routing.pins : new Map()).forEach(ps => { if (ps.length > 1) { collisions.push(ps); ps.forEach(p => flagged.add(p.part.id)); } });
  const big = project.parts.filter(p => modOf(project, p) && tooBig(p, modOf(project, p), project.board));
  big.forEach(p => flagged.add(p.id));
  const unrouted = routing ? routing.wires.filter(w => w.unrouted) : [];
  const missing = [];
  if (routing) routing.nets.forEach(n => n.missing.forEach(ref => missing.push({ net: n.name, ref })));
  return { antennaPairs, metalNearAntenna, collisions, tooBig: big, unrouted, missing, flagged };
}

/** Plain-language summary lines for the UI: [{ level: 'ok'|'warn'|'bad', text }]. */
export function summarise(project, a, routing) {
  const out = [], name = p => p.short || p.label || p.id, R = rules(project);
  if (!a.antennaPairs.length && !a.metalNearAntenna.length)
    out.push({ level: 'ok', text: '2.4 GHz antennas are spread out and clear of metal.' });
  if (a.antennaPairs.length)
    out.push({ level: 'bad', text: 'Antennas too close: ' + a.antennaPairs.map(([p, q, d]) => `${name(p)}–${name(q)} (${Math.round(d * 2.54)} mm)`).join(', ') +
      ` — aim for ≥ ${Math.round(R.antennaMinSep * 2.54)} mm.` });
  if (a.metalNearAntenna.length)
    out.push({ level: 'bad', text: 'Metal in an antenna zone: ' + a.metalNearAntenna.map(([p, m]) => `${name(m)} near ${name(p)}`).join(', ') +
      ` — keep ≥ ${Math.round(R.antennaKeep * 2.54)} mm clear.` });
  if (a.collisions.length)
    out.push({ level: 'bad', text: 'Two pins in one hole: ' + a.collisions.slice(0, 4).map(ps => ps.map(p => `${name(p.part)} ${p.name}`).join(' + ')).join('; ') +
      (a.collisions.length > 4 ? ' …' : '') });
  if (a.tooBig.length) out.push({ level: 'bad', text: "Won't fit on this board: " + a.tooBig.map(name).join(', ') + ' — make the board bigger.' });
  if (a.missing.length) out.push({ level: 'warn', text: 'Nets point at pins that don\'t exist: ' + a.missing.slice(0, 4).map(m => `${m.ref} (${m.net})`).join(', ') });
  if (routing && routing.mode === 'routed') {
    if (a.unrouted.length) out.push({ level: 'warn', text: `${a.unrouted.length} connection(s) unrouted (shown dotted).` });
    else if (routing.wires.length) out.push({ level: 'ok', text: `All ${routing.wires.length} connections routed.` });
  }
  const twoSided = project.parts.some(p => p.side === 'back' && !(modOf(project, p) || {}).offboard) && project.parts.some(p => p.side === 'front');
  if (twoSided) out.push({ level: 'info', text: 'Parts on both faces: use double-sided, plated-through perfboard.' });
  const unverified = [...new Set(project.parts.map(p => modOf(project, p)).filter(m => m && !m.verified).map(m => m.name))];
  if (unverified.length) out.push({ level: 'info', text: `Unverified pinouts (${unverified.length}): hover-check them against your modules' silkscreen.` });
  return out;
}
