// Project + module file formats, validation, and the editing operations the UI uses.
// Everything here is pure: functions take a project and either return a new value or
// mutate the project passed in (the UI snapshots before mutating, for undo).
// See docs/FORMATS.md for the formats in prose.

import { fitPart, partRect, rectsOverlap } from './geometry.js';

export const PROJECT_FORMAT = 'wireloom-project';
export const MODULE_FORMAT  = 'wireloom-module';
export const FORMAT_VERSION = 1;

export const DEFAULT_NET_CLASSES = {
  signal: { label: 'signal',      color: '#8ab4f8' },
  vcc:    { label: 'power',       color: '#ff6b6b' },
  gnd:    { label: 'GND',         color: '#9aa4b2' },
  sck:    { label: 'SPI clock',   color: '#ffe94d' },
  mosi:   { label: 'SPI MOSI',    color: '#4d8bff' },
  miso:   { label: 'SPI MISO',    color: '#ff9d4d' },
  cs:     { label: 'chip select', color: '#c77dff' },
  uart:   { label: 'serial',      color: '#56d4dd' },
  i2c:    { label: 'I²C',         color: '#7ee787' },
};

export const DEFAULT_RULES = {
  antennaMinSep: 8,          // holes between 2.4 GHz antenna points before warning (~20 mm)
  antennaKeep: 4,            // keep-out radius around each antenna, holes (~10 mm)
  router: { turn: 2, soft: 3, cross: 6, hop: 10, antennaZone: 8 },
};

export const SIDES = ['front', 'back'];
export const SIDE_LABEL = { front: 'front', back: 'back' };

/** A fresh, empty project. */
export function newProject(name = 'Untitled', cols = 40, rows = 30) {
  return {
    format: PROJECT_FORMAT, version: FORMAT_VERSION, name, notes: '',
    board: { cols, rows },
    netClasses: structuredClone(DEFAULT_NET_CLASSES),
    rules: structuredClone(DEFAULT_RULES),
    modules: {}, parts: [], nets: [],
  };
}

export const modOf    = (project, part) => project.modules[part.module];
export const partById = (project, id) => project.parts.find(p => p.id === id);
export const rules    = project => ({ ...DEFAULT_RULES, ...(project.rules || {}),
                                      router: { ...DEFAULT_RULES.router, ...((project.rules || {}).router || {}) } });
export const netClass = (project, cls) => (project.netClasses || {})[cls] || DEFAULT_NET_CLASSES[cls] || DEFAULT_NET_CLASSES.signal;

/* ------------------------------ validation ------------------------------ */

const isInt = v => Number.isInteger(v);
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Returns a list of human-readable problems with a module definition ([] = valid). */
export function validateModule(m) {
  const e = [];
  if (!m || typeof m !== 'object') return ['not an object'];
  if (m.format !== MODULE_FORMAT) e.push(`format must be "${MODULE_FORMAT}"`);
  if (!m.id || !/^[a-z0-9][a-z0-9._-]*$/.test(m.id)) e.push('id must be lowercase letters, digits, . _ -');
  if (!m.name) e.push('name is required');
  if (!m.size || !isInt(m.size.w) || !isInt(m.size.h) || m.size.w < 1 || m.size.h < 1 || m.size.w > 200 || m.size.h > 200)
    e.push('size.w and size.h must be whole numbers of holes (1–200)');
  if (!Array.isArray(m.pins)) e.push('pins must be a list');
  else {
    const seen = new Set();
    m.pins.forEach((p, i) => {
      if (!p || !p.name) e.push(`pin ${i + 1} has no name`);
      if (!isInt(p.x) || !isInt(p.y)) e.push(`pin "${p.name}" needs whole-number x and y`);
      else if (m.size && (p.x < 0 || p.y < 0 || p.x >= m.size.w || p.y >= m.size.h)) e.push(`pin "${p.name}" is outside the ${m.size.w}×${m.size.h} footprint`);
      const k = p.x + ',' + p.y;
      if (seen.has(k)) e.push(`two pins share hole ${p.x},${p.y}`);
      seen.add(k);
    });
  }
  if (m.antenna != null) {
    if (!['top', 'right', 'bottom', 'left'].includes(m.antenna.edge)) e.push('antenna.edge must be top/right/bottom/left');
    if (!m.antenna.band) e.push('antenna.band is required (e.g. "2.4GHz", "GNSS", "915MHz")');
  }
  if (m.color && !COLOR.test(m.color)) e.push('color must be #rrggbb');
  return e;
}

/** Returns { errors: [...], warnings: [...] } for a whole project. */
export function validateProject(p) {
  const errors = [], warnings = [];
  if (!p || typeof p !== 'object') return { errors: ['not a project file'], warnings };
  if (p.format !== PROJECT_FORMAT) errors.push(`not a Wireloom project (format "${p.format}")`);
  if (p.version > FORMAT_VERSION) errors.push(`made by a newer Wireloom (file v${p.version}, this is v${FORMAT_VERSION}) — update the app`);
  if (!p.board || !isInt(p.board.cols) || !isInt(p.board.rows) || p.board.cols < 4 || p.board.rows < 4)
    errors.push('board needs whole-number cols and rows (at least 4)');
  for (const [id, m] of Object.entries(p.modules || {})) {
    const me = validateModule(m);
    if (m && m.id !== id) me.push(`stored under "${id}" but its id is "${m.id}"`);
    me.forEach(x => errors.push(`module ${id}: ${x}`));
  }
  const ids = new Set();
  for (const part of p.parts || []) {
    if (!part.id) { errors.push('a part has no id'); continue; }
    if (ids.has(part.id)) errors.push(`two parts are called "${part.id}"`);
    ids.add(part.id);
    if (!(p.modules || {})[part.module]) errors.push(`part ${part.id} uses missing module "${part.module}"`);
    if (!['front', 'back'].includes(part.side)) errors.push(`part ${part.id}: side must be front or back`);
    if (![0, 90, 180, 270].includes(((part.rot % 360) + 360) % 360)) errors.push(`part ${part.id}: rotation must be a multiple of 90`);
  }
  const names = new Set(), owner = new Map();
  for (const n of p.nets || []) {
    if (names.has(n.name)) errors.push(`two nets are called "${n.name}"`);
    names.add(n.name);
    for (const ref of n.pins || []) {
      const [pid, pin] = String(ref).split(':');
      const part = (p.parts || []).find(x => x.id === pid), mod = part && (p.modules || {})[part.module];
      if (!part) { warnings.push(`net ${n.name}: no part "${pid}"`); continue; }
      if (mod && !mod.pins.some(q => q.name === pin)) warnings.push(`net ${n.name}: ${pid} has no pin "${pin}"`);
      if (owner.has(ref) && owner.get(ref) !== n.name) errors.push(`${ref} is in two nets (${owner.get(ref)}, ${n.name})`);
      owner.set(ref, n.name);
    }
    if ((n.pins || []).length < 2) warnings.push(`net ${n.name} connects fewer than two pins`);
  }
  return { errors, warnings };
}

/* ------------------------------ files ------------------------------ */

/**
 * Stable, diff-friendly JSON: two-space indent, but each pin and each net's pin list
 * on one line, so a module with 44 pins is 44 lines rather than 220.
 */
export function stringify(value) {
  // Placeholders must survive JSON.stringify unescaped, so plain ASCII with a random tag.
  const tag = 'WLINL' + Math.random().toString(36).slice(2, 8), inline = [];
  const hold = text => { const key = `@@${tag}_${inline.length}@@`; inline.push([key, text]); return key; };
  const json = JSON.stringify(value, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'name' in v && 'x' in v && 'y' in v && Object.keys(v).length <= 4)
      return hold(JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": '));
    if (k === 'pins' && Array.isArray(v) && v.length && v.every(s => typeof s === 'string'))
      return hold(JSON.stringify(v).replace(/","/g, '", "'));
    return v;
  }, 2);
  let out = json;
  for (const [key, text] of inline) out = out.replace('"' + key + '"', () => text);
  return out + '\n';
}

/** Parse a project file; throws an Error with a readable message if it is unusable. */
export function parseProject(text) {
  let p;
  try { p = JSON.parse(text); } catch (err) { throw new Error('This file is not valid JSON: ' + err.message); }
  p = migrate(p);
  const { errors } = validateProject(p);
  if (errors.length) throw new Error('This project has problems:\n• ' + errors.slice(0, 8).join('\n• '));
  return p;
}

/** Bring older files up to the current format (v1 is the first; nothing to do yet). */
export function migrate(p) {
  if (p && p.format === PROJECT_FORMAT) {
    p.netClasses = { ...DEFAULT_NET_CLASSES, ...(p.netClasses || {}) };
    p.rules = rules(p);
    p.notes = p.notes || '';
    for (const part of p.parts || []) { part.rot = part.rot || 0; part.mirrorPins = !!part.mirrorPins; }
  }
  return p;
}

/** Parse a module definition file; throws with a readable message if invalid. */
export function parseModule(text) {
  let m;
  try { m = JSON.parse(text); } catch (err) { throw new Error('This file is not valid JSON: ' + err.message); }
  const e = validateModule(m);
  if (e.length) throw new Error('This module has problems:\n• ' + e.slice(0, 8).join('\n• '));
  return m;
}

/* ------------------------------ editing ------------------------------ */

/** A part id that isn't taken yet, based on `base` ("nrf" -> "nrf", "nrf2", ...). */
export function freePartId(project, base) {
  const clean = String(base || 'part').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'part';
  if (!partById(project, clean)) return clean;
  const sep = /\d$/.test(clean) ? '_' : '';                  // nrf24l01 -> nrf24l01_2, not nrf24l012
  for (let i = 2; ; i++) if (!partById(project, clean + sep + i)) return clean + sep + i;
}

/** Add a module to the project and place one instance of it in the first free spot. */
export function addPart(project, mod, opts = {}) {
  project.modules[mod.id] = project.modules[mod.id] || structuredClone(mod);
  const m = project.modules[mod.id];
  const part = {
    id: freePartId(project, opts.id || (mod.short || mod.name || mod.id).split(/\s+/)[0].toLowerCase()),
    module: mod.id, label: opts.label || mod.name, x: 0, y: 0, rot: 0,
    side: opts.side || 'front', mirrorPins: false,
  };
  const spot = freeSpot(project, part, m);
  part.x = spot[0]; part.y = spot[1];
  fitPart(part, m, project.board);
  project.parts.push(part);
  return part;
}

/** First top-left position (scanning rows) where the part doesn't overlap anything on its side. */
export function freeSpot(project, part, mod) {
  const others = project.parts.filter(p => p.side === part.side && !(modOf(project, p) || {}).offboard)
                              .map(p => partRect(p, modOf(project, p)));
  for (let y = 0; y < project.board.rows; y++)
    for (let x = 0; x < project.board.cols; x++) {
      const r = partRect({ ...part, x, y }, mod);
      if (r.x + r.w > project.board.cols || r.y + r.h > project.board.rows) continue;
      if (!others.some(o => rectsOverlap(o, r))) return [x, y];
    }
  return [0, 0];
}

/** Remove a part, its pins from every net, and (if now unused) its module. */
export function removePart(project, id) {
  const part = partById(project, id);
  if (!part) return;
  project.parts = project.parts.filter(p => p.id !== id);
  for (const n of project.nets) n.pins = n.pins.filter(ref => ref.split(':')[0] !== id);
  project.nets = project.nets.filter(n => n.pins.length > 0);
  if (!project.parts.some(p => p.module === part.module)) delete project.modules[part.module];
}

/** Which net (if any) contains this "part:pin" reference. */
export const netOfPin = (project, ref) => project.nets.find(n => n.pins.includes(ref)) || null;

/** A net name that isn't taken yet: N1, N2, ... */
export function freeNetName(project, base = 'N') {
  for (let i = 1; ; i++) if (!project.nets.some(n => n.name === base + i)) return base + i;
}

/**
 * Connect two pins. Joins their nets (keeping the first net's name and class), or
 * puts the loose pin into the other's net, or makes a new net. Returns the net.
 */
export function connect(project, refA, refB) {
  if (refA === refB) return netOfPin(project, refA);
  const a = netOfPin(project, refA), b = netOfPin(project, refB);
  if (a && b) {
    if (a === b) return a;
    a.pins.push(...b.pins.filter(r => !a.pins.includes(r)));
    project.nets = project.nets.filter(n => n !== b);
    return a;
  }
  if (a) { a.pins.push(refB); return a; }
  if (b) { b.pins.push(refA); return b; }
  const n = { name: freeNetName(project), class: 'signal', pins: [refA, refB] };
  project.nets.push(n);
  return n;
}

/** Take one pin out of its net (deleting the net if it would be left with < 2 pins). */
export function disconnect(project, ref) {
  const n = netOfPin(project, ref);
  if (!n) return;
  n.pins = n.pins.filter(r => r !== ref);
  if (n.pins.length < 2) project.nets = project.nets.filter(x => x !== n);
}

/** Rename a net; returns an error message or null. */
export function renameNet(project, oldName, newName) {
  const name = String(newName || '').trim();
  if (!name) return 'a net needs a name';
  if (name !== oldName && project.nets.some(n => n.name === name)) return `there's already a net called "${name}"`;
  const n = project.nets.find(x => x.name === oldName);
  if (n) n.name = name;
  return null;
}
