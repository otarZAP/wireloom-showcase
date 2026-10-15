// Shared browser-test helpers: drive the built app (dist/index.html) in the installed
// Microsoft Edge via puppeteer-core — nothing extra to download.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href;

const EDGE = [
  process.env.WIRELOOM_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));

export async function launch({ width = 1500, height = 950 } = {}) {
  if (!EDGE) throw new Error('No Edge/Chrome found; set WIRELOOM_BROWSER to a Chromium executable');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireloom-e2e-'));
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir,
    args: ['--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`,
           ...(process.env.CI ? ['--no-sandbox'] : [])],          // CI containers can't use Chrome's sandbox
    defaultViewport: { width, height } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(DIST, { waitUntil: 'load' });
  await page.waitForSelector('#boardHost svg');
  return { browser, page, errors, close: async () => { await browser.close(); try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {} } };
}

/** Centre of the first element matching selector, in page pixels. */
export async function centre(page, selector) {
  const box = await (await page.$(selector)).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

export const state = page => page.evaluate(() => ({
  parts: document.querySelectorAll('#boardHost [data-part]').length,
  pads: document.querySelectorAll('#boardHost [data-pin]').length,
  wires: document.querySelectorAll('#boardHost polyline').length,
  status: document.getElementById('statusInfo').textContent,
  hover: document.getElementById('statusHover').textContent,
  dirty: document.getElementById('dirty').textContent,
  title: document.title,
}));
