// Renders the Wireloom logo (src/ui/brand.js) to build/icon.png (512x512, transparent).
// electron-builder turns that into the Windows .ico. Run after changing the logo:
//   node tools/make-icon.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { LOGO } from '../src/ui/brand.js';

const exe = [process.env.WIRELOOM_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
             'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  .filter(Boolean).find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512 });
await page.setContent(`<html><body style="margin:0;background:transparent">${LOGO.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`);
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
await page.screenshot({ path: new URL('../build/icon.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: true });
await browser.close();
console.log('build/icon.png written');
