// Core library tests. Run: npm test   (Node's built-in runner, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as W from '../src/core/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const example = () => W.migrate(readJSON('examples/gps-trail-logger.wireloom'));
const SNAP = readJSON('test/fixtures/example-snapshot.json');
const pin = (p, id, name) => { const part = W.partById(p, id); return W.partPins(part, W.modOf(p, part)).find(q => q.name === name); };
const at = (q, x, y) => !!q && q.x === x && q.y === y;

/* ---------------------------- files + validation ---------------------------- */

test('example project validates with no errors or warnings', () => {
  const { errors, warnings } = W.validateProject(example());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('every library module validates', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'library')).filter(f => f.endsWith('.module.json'))) {
    const m = readJSON('library/' + f);
    assert.deepEqual(W.validateModule(m), [], f);
    assert.equal(m.id + '.module.json', f, 'file name matches id');
  }
});

test('stringify -> parseProject round-trips exactly, and stays compact', () => {
  const p = example(), text = W.stringify(p);
  assert.deepEqual(W.parseProject(text), p);
  assert.match(text, /\{ ?"name": "IO12", "x": \d+, "y": \d+ ?\}/, 'one pin per line');
  assert.ok(text.split('\n').length < 800, 'project file stays readable');
});

test('validation catches broken files with readable messages', () => {
  assert.throws(() => W.parseProject('{nope'), /not valid JSON/);
  assert.throws(() => W.parseProject(JSON.stringify({ format: 'x' })), /not a Wireloom project/);
  const p = example(); p.version = 99;
  assert.throws(() => W.parseProject(JSON.stringify(p)), /newer Wireloom/);
  const q = example(); q.parts[0].module = 'ghost';
  assert.match(W.validateProject(q).errors.join(), /missing module "ghost"/);
  const r = example(); r.nets[1].pins.push('esp:IO12');
  assert.match(W.validateProject(r).errors.join(), /esp:IO12 is in two nets/);
  const m = readJSON('library/nrf24l01.module.json');
  m.pins[1].x = m.pins[0].x; m.pins[1].y = m.pins[0].y;          // CSN onto VCC's hole
  m.pins[2].x = m.size.w;                                         // MOSI off the footprint
  const errs = W.validateModule(m).join(' | ');
  assert.match(errs, /two pins share hole/); assert.match(errs, /outside the 6×11 footprint/);
});

/* ---------------------------- geometry (hand-computed holes) ---------------------------- */

test('ESP32 on the back, rotated 90°: pins land where they were hand-computed', () => {
  const p = example();
  assert.ok(at(pin(p, 'esp', 'IO12'), 11, 10));
  assert.ok(at(pin(p, 'esp', 'IO1'), 25, 1));
  assert.ok(at(pin(p, 'esp', 'IO40'), 21, 1));
  assert.equal(Math.abs(pin(p, 'esp', 'IO4').y - pin(p, 'esp', 'IO1').y), 9, 'headers 0.9" apart');
});

test('a back-side part mirrors; Mirror pinout flips it back', () => {
  const p = example();
  W.partById(p, 'esp').mirrorPins = true;                      // J1 and J3 swap rows
  assert.ok(at(pin(p, 'esp', 'IO12'), 11, 1));
  assert.ok(at(pin(p, 'esp', 'IO1'), 25, 10));
});

test('front-side parts: TFT header along the bottom, GPS rotated 90°', () => {
  const p = example();
  assert.ok(at(pin(p, 'tft', 'VCC'), 8, 42) && at(pin(p, 'tft', 'SCK'), 14, 42));
  assert.ok(at(pin(p, 'gps', 'VCC'), 1, 4) && at(pin(p, 'gps', 'TX'), 1, 6));
});

test('antenna points: ESP at the right board edge; any edge supported', () => {
  const p = example(), esp = W.partById(p, 'esp');
  assert.deepEqual(W.antennaPoint(esp, W.modOf(p, esp)), [30, 6]);
  const mod = { size: { w: 4, h: 6 }, antenna: { edge: 'left', band: '2.4GHz' } };
  assert.deepEqual(W.antennaPoint({ x: 0, y: 0, rot: 0, side: 'front' }, mod), [0, 3]);
  assert.deepEqual(W.antennaPoint({ x: 0, y: 0, rot: 90, side: 'front' }, mod), [3, 0]);   // left edge -> top
  assert.equal(W.placedEdge({ rot: 90, side: 'front' }, 'left'), 'top');
  assert.equal(W.placedEdge({ rot: 0, side: 'back' }, 'left'), 'right');
});

test('hole transform is a bijection for every rotation and side', () => {
  const mod = { size: { w: 5, h: 3 }, pins: [] };
  for (const rot of [0, 90, 180, 270]) for (const side of ['front', 'back']) {
    const part = { x: 2, y: 3, rot, side, mirrorPins: false }, seen = new Set(), [w, h] = W.placedSize(part, mod);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const [bx, by] = W.holeToBoard(part, mod, x, y);
      assert.ok(bx >= 2 && by >= 3 && bx < 2 + w && by < 3 + h, `inside footprint (${rot},${side})`);
      seen.add(bx + ',' + by);
    }
    assert.equal(seen.size, 15, `no two holes collide (${rot},${side})`);
  }
});

test('fitPart: TFT turns to fit a landscape board, and back toward 0°', () => {
  const p = example(), tft = W.partById(p, 'tft'), m = W.modOf(p, tft);
  W.fitPart(tft, m, { cols: 56, rows: 30 });
  assert.deepEqual(W.placedSize(tft, m), [31, 22]);
  W.fitPart(tft, m, { cols: 30, rows: 56 });
  assert.deepEqual(W.placedSize(tft, m), [22, 31]);
  assert.equal(tft.rot, 0);
});

/* ---------------------------- nets ---------------------------- */

test('nets: everything resolves; the electrical rules hold', () => {
  const p = example(), nets = W.resolveNets(p), by = n => nets.find(x => x.name === n);
  assert.ok(nets.every(n => n.missing.length === 0));
  const gnd = by('GND');
  assert.ok(!gnd.nodes.some(q => q.part.id === 'tp' && q.name === 'B-'), 'TP4056 B− is NOT ground');
  assert.ok(gnd.nodes.some(q => q.part.id === 'tp' && q.name === 'OUT-'), 'OUT− is ground');
  assert.equal(gnd.nodes.filter(q => q.part.id === 'esp').length, 1, 'ESP duplicate GNDs collapse to one');
  assert.deepEqual(by('MISO').nodes.map(q => q.part.id).sort(), ['esp', 'sd'], 'TFT SDO left open');
  assert.deepEqual(by('GPS_RX').nodes.map(q => q.ref).sort(), ['esp:IO9', 'gps:TX']);
});

/* ---------------------------- routing ---------------------------- */

test('routing matches the recorded snapshot (regression check) and is fast', () => {
  const p = example(), t0 = performance.now(), r = W.routeProject(p, 'routed'), ms = performance.now() - t0;
  assert.equal(r.wires.length, SNAP.wires);
  const total = r.wires.reduce((s, w) => s + w.len, 0);
  assert.ok(Math.abs(total - SNAP.totalLen) < 1e-9, `total ${total} vs snapshot ${SNAP.totalLen}`);
  assert.ok(ms < 500, `routing took ${ms.toFixed(0)} ms`);
});

test('routed paths are valid: orthogonal unit steps, on-board, pin to pin', () => {
  const p = example(), r = W.routeProject(p);
  assert.ok(r.wires.filter(w => !w.lead).every(w => w.routed));
  assert.equal(r.wires.filter(w => w.lead).length, 2, 'two battery leads');
  for (const w of r.wires.filter(w => w.routed)) {
    const c = w.cells;
    assert.deepEqual(c[0], [w.a.x, w.a.y]); assert.deepEqual(c.at(-1), [w.b.x, w.b.y]);
    for (let i = 1; i < c.length; i++) assert.equal(Math.abs(c[i][0] - c[i - 1][0]) + Math.abs(c[i][1] - c[i - 1][1]), 1);
    assert.ok(c.every(([x, y]) => x >= 0 && y >= 0 && x < p.board.cols && y < p.board.rows));
  }
  assert.ok(W.routeProject(p, 'ratsnest').wires.every(w => !w.routed && w.path.length === 2));
});

test('corners() keeps only bends', () => {
  assert.deepEqual(W.corners([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]), [[0, 0], [2, 0], [2, 2]]);
});

/* ---------------------------- checks ---------------------------- */

test('checks: the example is clean', () => {
  const p = example(), r = W.routeProject(p), a = W.analyse(p, r);
  assert.equal(a.antennaPairs.length + a.metalNearAntenna.length + a.collisions.length + a.tooBig.length + a.unrouted.length, 0);
  assert.ok(W.summarise(p, a, r).some(x => x.level === 'ok' && /antennas/.test(x.text)));
});

test('checks: antennas too close, ESP antenna behind the TFT, two pins in a hole, too big', () => {
  let p = example();
  const nrf = W.addPart(p, readJSON('library/nrf24l01.module.json'), { side: 'front' });
  Object.assign(nrf, { x: 19, y: 2, rot: 90 });                 // its antenna lands right beside the ESP's
  let a = W.analyse(p, W.routeProject(p, 'ratsnest'));
  assert.ok(a.antennaPairs.some(([x, y]) => [x.id, y.id].sort().join() === [nrf.id, 'esp'].sort().join()));
  assert.match(W.summarise(p, a).map(x => x.text).join(), /Antennas too close: .*ESP32-S3/);
  p = example(); Object.assign(W.partById(p, 'esp'), { x: 2, y: 12 });
  a = W.analyse(p, W.routeProject(p, 'ratsnest'));
  assert.ok(a.metalNearAntenna.some(([ant, m]) => ant.id === 'esp' && m.id === 'tft'));
  p = example(); Object.assign(W.partById(p, 'div'), { x: 6, y: 28 });   // divider VIN onto the SD's GND pin
  a = W.analyse(p, W.routeProject(p, 'ratsnest'));
  assert.ok(a.collisions.some(ps => ps.some(q => q.ref === 'sd:GND') && ps.some(q => q.ref === 'div:VIN')));
  p = example(); p.board = { cols: 20, rows: 20 };
  assert.ok(W.analyse(p, null).tooBig.some(x => x.id === 'tft'));
});

/* ---------------------------- editing ---------------------------- */

test('addPart finds a free spot and a free id; removePart cleans up', () => {
  const p = example(), nrf = readJSON('library/nrf24l01.module.json');
  const a = W.addPart(p, nrf, { side: 'back' });
  assert.equal(a.id, 'nrf24l01', 'id derived from the module name');
  const b = W.addPart(p, nrf, { side: 'back' });
  assert.equal(b.id, 'nrf24l01_2', 'second copy gets a readable suffix');
  assert.equal(new Set(p.parts.map(x => x.id)).size, p.parts.length);
  for (const part of [a, b]) {
    const mine = W.partRect(part, nrf);
    for (const o of p.parts) if (o !== part && o.side === 'back' && !W.modOf(p, o).offboard)
      assert.ok(!W.rectsOverlap(mine, W.partRect(o, W.modOf(p, o))), `${part.id} overlaps ${o.id}`);
  }
  W.removePart(p, a.id);
  assert.ok(p.modules['nrf24l01'], 'module kept while another part uses it');
  W.removePart(p, b.id);
  assert.ok(!p.modules['nrf24l01'], 'unused module dropped');
  W.removePart(p, 'gps');
  assert.ok(!p.nets.some(n => n.pins.some(r => r.startsWith('gps:'))), 'GPS pins gone from every net');
  assert.ok(!p.modules['gy-neo6mv2-gps']);
  assert.deepEqual(W.validateProject(p).errors, []);
});

test('connect / disconnect / rename', () => {
  const p = W.newProject('t');
  const a = W.addPart(p, readJSON('library/divider-2x100k.module.json'));
  const b = W.addPart(p, readJSON('library/ss12d00-slide-switch.module.json'));
  const n = W.connect(p, `${a.id}:MID`, `${b.id}:COM`);
  assert.equal(n.name, 'N1'); assert.equal(p.nets.length, 1);
  W.connect(p, `${a.id}:GND`, `${b.id}:NC`);
  assert.equal(p.nets.length, 2);
  W.connect(p, `${a.id}:MID`, `${a.id}:GND`);            // joins N1 and N2
  assert.equal(p.nets.length, 1); assert.equal(p.nets[0].pins.length, 4);
  assert.equal(W.renameNet(p, 'N1', 'N1'), null);
  W.connect(p, `${b.id}:ON`, `${a.id}:VIN`);
  assert.match(W.renameNet(p, p.nets[1].name, 'N1'), /already/);
  W.disconnect(p, `${b.id}:ON`);
  assert.equal(p.nets.length, 1, 'a net left with one pin is removed');
  assert.deepEqual(W.validateProject(p).errors, []);
});

/* ---------------------------- rendering + outputs ---------------------------- */

test('renderBoard: every view is well-formed and mirrors correctly', () => {
  const p = example(), r = W.routeProject(p), a = W.analyse(p, r);
  for (const view of ['both', 'front', 'back']) for (const interactive of [false, true]) {
    const s = W.renderBoard(p, r, a, { view, interactive, title: interactive ? '' : 'T' });
    assert.ok(s.startsWith('<svg') && s.endsWith('</svg>'), view);
    assert.ok(!/NaN|undefined/.test(s), view + ' has no NaN/undefined');
    assert.equal((s.match(/<svg/g) || []).length, 1);
  }
  const back = W.renderBoard(p, r, a, { view: 'back' }), front = W.renderBoard(p, r, a, { view: 'front' });
  assert.equal((back.match(/<polyline/g) || []).length, 2 * r.wires.filter(w => w.routed).length + r.wires.filter(w => !w.routed).length);
  assert.ok(!/polyline/.test(front), 'no wires on the front view');
  const io12 = pin(p, 'esp', 'IO12');
  for (const view of ['both', 'back']) {
    const L = W.layout(p, { view, pitch: 14 });
    const px = L.ox + ((view === 'back' ? p.board.cols - (io12.x + 0.5) : io12.x + 0.5)) * 14, py = L.oy + (io12.y + 0.5) * 14;
    assert.deepEqual(W.holeAt(p, L, px, py), [io12.x, io12.y], view);
  }
});

test('wire list rows, CSV, cut list and build sheet', () => {
  const p = example(), r = W.routeProject(p), rows = W.wireRows(r);
  assert.equal(rows.length, r.wires.length);
  assert.ok(rows.some(x => x.from.hole === 'c12 r11' || x.to.hole === 'c12 r11'), 'ESP IO12 hole label');
  const csv = W.wireListCSV(rows);
  assert.equal(csv.trim().split('\n').length, rows.length + 1);
  assert.match(csv.split('\n')[0], /^#,Net,From part/);
  const cut = W.cutList(rows, p);
  assert.equal(cut.reduce((s, c) => s + c.count, 0), rows.filter(x => !x.lead).length);
  assert.equal(W.totalLengthCm(r), Math.round(SNAP.totalLen * 2.54 / 10));
  const sheet = W.buildSheetHTML(p, r, W.analyse(p, r), { version: 'test' });
  assert.match(sheet, /<h1>GPS Trail Logger<\/h1>/);
  assert.equal((sheet.match(/<svg /g) || []).length, 2, 'front + solder-side drawings');
});
