// A self-contained, printable "build sheet" for a project: drawings of both faces,
// checks, BOM, cut list and the wire list as a tick-off checklist. Pure: returns HTML.

import { modOf, netClass } from './project.js';
import { renderBoard } from './svg.js';
import { summarise } from './checks.js';
import { wireRows, cutList, totalLengthCm } from './wirelist.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSheetHTML(project, routing, analysis, { version = '', date = new Date() } = {}) {
  const rows = wireRows(routing), cut = cutList(rows, project), checks = summarise(project, analysis, routing);
  const front = renderBoard(project, routing, analysis, { view: 'front', title: 'FRONT — as you hold it', idPrefix: 'bsf' });
  const back = renderBoard(project, routing, analysis, { view: 'back', title: 'BACK — solder side (mirrored)', idPrefix: 'bsb' });
  const bom = new Map();
  for (const p of project.parts) {
    const m = modOf(project, p); if (!m) continue;
    if (!bom.has(m.id)) bom.set(m.id, { m, parts: [] });
    bom.get(m.id).parts.push(p);
  }
  const icon = { ok: '✓', bad: '⚠', warn: '!', info: 'i' };
  const when = date.toISOString().slice(0, 10);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.name)} — build sheet</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 60px}h1{margin:0 0 4px;font-size:26px}
h2{font-size:18px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:5px;margin:30px 0 10px}
.sub{color:var(--muted);margin:0 0 16px}.duo{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px}.box svg{width:100%;height:auto;display:block}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:4px 9px;text-align:left;vertical-align:top}
th{background:#1c2230}td.m{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px;border:1px solid #ffffff40}
.chk{margin:3px 0}.chk.bad{color:#ffb4ae}.chk.ok b{color:#3fb950}.chk.bad b{color:#f85149}.chk.warn b,.chk.info b{color:#f0883e}
.tick{width:16px;height:16px;border:1.5px solid var(--muted);border-radius:3px;display:inline-block}
.note{color:var(--muted);font-size:12.5px}.foot{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:10px}
@media (max-width:800px){.duo{grid-template-columns:1fr}}
@media print{body{background:#fff;color:#000}.box{border-color:#bbb;background:#fff}th{background:#eee}th,td{border-color:#bbb}
  h2{color:#000;border-color:#bbb;break-after:avoid}.tick{border-color:#555}.duo{grid-template-columns:1fr 1fr}tr{break-inside:avoid}}
</style></head><body><div class="wrap">
<h1>${esc(project.name)}</h1>
<p class="sub">Build sheet · ${project.board.cols}×${project.board.rows} holes (~${Math.round(project.board.cols * 2.54)}×${Math.round(project.board.rows * 2.54)} mm) ·
${project.parts.length} parts · ${rows.length} wires · ~${totalLengthCm(routing)} cm of wire · ${when}</p>
${project.notes ? `<p>${esc(project.notes)}</p>` : ''}
<h2>Checks</h2>
${checks.map(c => `<div class="chk ${c.level}"><b>${icon[c.level]}</b> ${esc(c.text)}</div>`).join('')}
<h2>Layout</h2>
<div class="duo"><div class="box">${front}</div><div class="box">${back}</div></div>
<p class="note">Holes are counted from the <b>front-left</b> corner (column · row). On the solder side, column 1 is on your right.
Mark "FRONT TOP" and "C1" on the board before you start.</p>
<h2>Parts</h2>
<table><tr><th>Qty</th><th>Module</th><th>On the board as</th><th>Pinout</th><th>Check before soldering</th></tr>
${[...bom.values()].map(({ m, parts }) => `<tr><td>${parts.length}</td><td>${esc(m.name)}</td>
<td>${parts.map(p => `${esc(p.label || p.id)} <span class="note">(${p.side}${m.offboard ? ', off-board' : ''})</span>`).join('<br>')}</td>
<td>${m.verified ? 'verified' : '<b style="color:#f0883e">unverified</b>'}</td><td class="note">${esc(m.verify || '')}</td></tr>`).join('')}
</table>
<h2>Cut list</h2>
<table><tr><th>Wire colour / class</th><th>Count</th><th>Lengths (mm, incl. 10 mm strip)</th><th>Total</th></tr>
${cut.map(c => `<tr><td><span class="sw" style="background:${netClass(project, c.cls).color}"></span>${esc(c.label)}</td><td>${c.count}</td><td>${c.lengths.join(', ')}</td><td>${Math.round(c.totalMm / 10)} cm</td></tr>`).join('')}
</table>
<h2>Wire list</h2>
<table><tr><th></th><th>#</th><th>Net</th><th>From</th><th>To</th><th>Length</th></tr>
${rows.map(r => `<tr><td><span class="tick"></span></td><td>${r.n}</td><td><span class="sw" style="background:${netClass(project, r.cls).color}"></span>${esc(r.net)}${r.lead ? ' (lead)' : ''}${r.unrouted ? ' — unrouted' : ''}</td>
<td class="m">${esc(r.from.part)} ${esc(r.from.pin)} · ${esc(r.from.hole)}</td><td class="m">${esc(r.to.part)} ${esc(r.to.pin)} · ${esc(r.to.hole)}</td><td>${r.lengthMm} mm</td></tr>`).join('')}
</table>
<div class="foot">Generated by Wireloom${version ? ' ' + esc(version) : ''}. Pinouts marked unverified are modelled from common modules — check them against your parts' silkscreen.</div>
</div></body></html>`;
}
