import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const throttle = process.argv[2] === 'net';
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
const cdp = await page.context().newCDPSession(page);
if (throttle) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: (50e6 / 8) | 0, uploadThroughput: (10e6 / 8) | 0 });
}
await page.addInitScript(() => {
  window.__t = {};
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push([Math.round(t), Math.round(t - last)]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new MutationObserver(() => {
    const d = document.body?.dataset; if (!d) return;
    for (const k of ['settled', 'converged', 'tier', 'backend']) if (d[k] !== undefined && window.__t[k] === undefined) window.__t[k] = Math.round(performance.now());
  }).observe(document, { attributes: true, subtree: true });
});
await page.goto('http://localhost:4322/?tier=high');
await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 120000 });
const r = await page.evaluate(() => ({ t: window.__t, ready: performance.getEntriesByName('atlas:ready')[0]?.startTime, conv: performance.getEntriesByName('atlas:converged')[0]?.startTime, frames: window.__frames.length, slow: window.__frames.filter((f) => f[1] > 50).map((f) => f.join('@')).slice(0, 15), fontsReady: document.fonts.status }));
console.log(JSON.stringify(r));
await browser.close();
