// Geometry on the hole grid.
//
// Units are 0.1" holes. Board coordinates are FRONT-view: x to the right, y down,
// origin at the front-left corner. A module's own (local) coordinates are with its
// parts side up and unrotated. A part on the BACK of the board is seen from
// underneath, so its pinout mirrors left-right; `mirrorPins` flips that again for
// modules whose real pinout is the reverse of the library definition.

export const EDGES = ['top', 'right', 'bottom', 'left'];

export const norm  = r => ((r % 360) + 360) % 360;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Footprint size as placed on the board: [w, h] in holes. */
export function placedSize(part, mod) {
  return norm(part.rot) % 180 === 0 ? [mod.size.w, mod.size.h] : [mod.size.h, mod.size.w];
}

/** True when the part's pinout appears mirrored in front-view coordinates. */
export const isMirrored = part => (part.side === 'back') !== !!part.mirrorPins;

/** Continuous local point (u, v) in [0,w]x[0,h] -> continuous board point [x, y]. */
export function localToBoard(part, mod, u, v) {
  const { w, h } = mod.size, R = norm(part.rot);
  const a = isMirrored(part) ? w - u : u;
  if (R === 0)   return [part.x + a,     part.y + v];
  if (R === 90)  return [part.x + h - v, part.y + a];
  if (R === 180) return [part.x + w - a, part.y + h - v];
  return               [part.x + v,     part.y + w - a];
}

/** Local hole (lx, ly) -> board hole [x, y] (integers). */
export function holeToBoard(part, mod, lx, ly) {
  const [x, y] = localToBoard(part, mod, lx + 0.5, ly + 0.5);
  return [Math.floor(x), Math.floor(y)];
}

/** Every pin of a placed part, in board holes. */
export function partPins(part, mod) {
  return mod.pins.map(p => {
    const [x, y] = holeToBoard(part, mod, p.x, p.y);
    return { part, mod, name: p.name, x, y };
  });
}

/** Which board edge a local edge ends up on after mirroring and rotation. */
export function placedEdge(part, edge) {
  let e = edge;
  if (isMirrored(part)) e = e === 'left' ? 'right' : e === 'right' ? 'left' : e;
  return EDGES[(EDGES.indexOf(e) + norm(part.rot) / 90) % 4];
}

/** Antenna feed point (continuous board coords): centre of the antenna edge. */
export function antennaPoint(part, mod) {
  if (!mod.antenna) return null;
  const { w, h } = mod.size, e = mod.antenna.edge || 'top';
  const [u, v] = e === 'top' ? [w / 2, 0] : e === 'bottom' ? [w / 2, h] : e === 'left' ? [0, h / 2] : [w, h / 2];
  return localToBoard(part, mod, u, v);
}

/** Axis-aligned board rectangle of a placed part. */
export function partRect(part, mod) {
  const [w, h] = placedSize(part, mod);
  return { x: part.x, y: part.y, w, h };
}

export const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const pointInRect  = (r, px, py) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
export function circleHitsRect(cx, cy, rad, r) {
  const nx = clamp(cx, r.x, r.x + r.w), ny = clamp(cy, r.y, r.y + r.h);
  return Math.hypot(cx - nx, cy - ny) < rad;
}

/** Would this part fit the board in its current orientation? */
export function tooBig(part, mod, board) {
  const [w, h] = placedSize(part, mod);
  return w > board.cols || h > board.rows;
}

/**
 * Keep a part on the board. If it only fits turned 90°, turn it — that is how
 * it would be mounted — choosing the direction that lands nearer 0° so labels
 * and antennas don't end up needlessly upside down. Mutates and returns `part`.
 */
export function fitPart(part, mod, board) {
  let [w, h] = placedSize(part, mod);
  if ((w > board.cols || h > board.rows) && h <= board.cols && w <= board.rows) {
    const a = norm(part.rot + 90), b = norm(part.rot - 90), d = r => Math.min(r, 360 - r);
    part.rot = d(a) <= d(b) ? a : b;
    [w, h] = placedSize(part, mod);
  }
  part.x = clamp(Math.round(part.x), 0, Math.max(0, board.cols - w));
  part.y = clamp(Math.round(part.y), 0, Math.max(0, board.rows - h));
  return part;
}

/** Physical hole label, 1-based from the front-left corner: "c12 r22". */
export const holeLabel = (x, y) => 'c' + (x + 1) + ' r' + (y + 1);
