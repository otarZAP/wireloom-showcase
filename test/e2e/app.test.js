// End-to-end: drives the built app (dist/index.html) in headless Edge.
// Run: npm run build && npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, centre, state } from './helpers.js';

let app, page;
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = sel => page.$eval(sel, e => e.textContent);
const placed = async () => (await text('#inspector')).match(/c\d+ r\d+/)?.[0];
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireloom-dl-'));

before(async () => {
  app = await launch(); page = app.page;
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
});
after(async () => { await app.close(); fs.rmSync(dlDir, { recursive: true, force: true }); });

test('opens the example project cleanly', async () => {
  const s = await state(page);
  assert.equal(s.parts, 10);
  assert.match(s.status, /36 wires · routed in/);
  assert.match(await text('#checks'), /All 36 connections routed/);
  assert.equal((await page.$$('#wireList tr[data-net]')).length, 36);
  assert.deepEqual(app.errors, []);
});

test('drag moves a part; undo puts it back; the title shows unsaved', async () => {
  await page.click('[data-cmd="zoomIn"]'); await page.click('[data-cmd="zoomIn"]');
  const [x, y] = await centre(page, '#boardHost [data-part="gps"]');
  await page.mouse.click(x, y);
  const start = await placed();
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 8 });
  await page.mouse.up();
  await wait(50);
  const moved = await placed();
  assert.notEqual(moved, start, 'position changed');
  assert.match((await state(page)).dirty, /unsaved/);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await wait(50);
  assert.equal(await placed(), start, 'undo restored it');
});

test('hovering a pin reports its net and hole', async () => {
  const [x, y] = await centre(page, '#boardHost [data-pin="esp:IO12"]');
  await page.mouse.move(x, y);
  await wait(50);
  assert.match((await state(page)).hover, /IO12 · net SCK · c12 r11/);
});

test('back view is the mirrored solder side', async () => {
  await page.keyboard.press('3');
  try {
    await wait(50);
    const s = await state(page);
    assert.ok(s.wires > 0 && s.pads === 91, `pads=${s.pads}`);   // 89 on-board pins + 2 battery leads
    const [x, y] = await centre(page, '#boardHost [data-pin="esp:IO12"]');
    await page.mouse.move(x, y);
    await wait(50);
    assert.match((await state(page)).hover, /IO12 · net SCK · c12 r11/, 'same physical hole, mirrored drawing');
  } finally {
    await page.keyboard.press('1');                  // back to Both even on failure, so later tests aren't affected
  }
});

test('build sheet exports a complete HTML page', async () => {
  await page.click('[data-cmd="exportSheet"]');
  let f = null;
  for (let i = 0; i < 40 && !f; i++) { await wait(100); f = fs.readdirSync(dlDir).find(n => n.endsWith('build-sheet.html')); }
  assert.ok(f, 'downloaded');
  const html = fs.readFileSync(path.join(dlDir, f), 'utf8');
  assert.match(html, /<h1>GPS Trail Logger<\/h1>/);
  assert.equal((html.match(/<svg /g) || []).length, 2, 'front + solder-side drawings');
  assert.match(html, /Cut list/); assert.match(html, /Wire list/);
});

test('new project → add parts from the library → wire them with Connect', async () => {
  await page.keyboard.down('Control'); await page.keyboard.press('n'); await page.keyboard.up('Control');
  await page.waitForSelector('.dialog');
  if (await page.$('[data-b="discard"]')) { await page.click('[data-b="discard"]'); await page.waitForSelector('.dialog [name="name"]'); }
  await page.$eval('.dialog [name="name"]', e => { e.value = 'E2E board'; });
  await page.click('[data-b="ok"]');
  await wait(50);
  assert.equal((await state(page)).parts, 0);
  assert.equal(await page.$eval('#projName', e => e.value), 'E2E board');
  assert.match((await state(page)).title, /E2E board — Wireloom/);
  for (const id of ['divider-2x100k', 'ss12d00-slide-switch']) {
    await page.click(`#libPanel [data-mod="${id}"] .nm`);
    await page.waitForSelector(`#libPanel [data-add="${id}"][data-side="front"]`);
    await page.click(`#libPanel [data-add="${id}"][data-side="front"]`);
    await wait(30);
  }
  assert.equal((await state(page)).parts, 2);
  await page.keyboard.press('c');
  const pads = await page.$$eval('#boardHost [data-pin]', es => es.map(e => e.dataset.pin));
  const a = pads.find(p => p.endsWith(':MID')), b = pads.find(p => p.endsWith(':COM'));
  await page.click(`#boardHost [data-pin="${a}"]`);
  assert.match(await text('#toolHint'), /Connecting from/);
  await page.click(`#boardHost [data-pin="${b}"]`);
  await wait(50);
  assert.equal((await page.$$('#nets [data-netrow]')).length, 1);
  assert.equal((await page.$$('#wireList tr[data-net]')).length, 1);
  assert.match(await text('#checks'), /All 1 connections routed/);
  // disconnect it again
  await page.keyboard.press('x');
  await page.click(`#boardHost [data-pin="${a}"]`);
  await wait(50);
  assert.equal((await page.$$('#nets [data-netrow]')).length, 0);
  await page.keyboard.press('Escape');
});

test('rotate, delete and undo from the keyboard', async () => {
  await page.keyboard.press('v');
  const [x, y] = await centre(page, '#boardHost [data-part]');
  await page.mouse.click(x, y);
  const before = await text('#inspector');
  await page.keyboard.press('r');
  await wait(30);
  assert.notEqual(await text('#inspector'), before, 'rotation shows in the inspector');
  const n = (await state(page)).parts;
  await page.keyboard.press('Delete');
  await wait(30);
  assert.equal((await state(page)).parts, n - 1);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await wait(30);
  assert.equal((await state(page)).parts, n);
});

test('no JavaScript errors anywhere along the way', () => {
  assert.deepEqual(app.errors, []);
});
