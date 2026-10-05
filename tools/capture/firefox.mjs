// Firefox pass (plan §13 risk 6): stock Firefox driven over WebDriver BiDi (Playwright's Firefox is a patched
// build and a separate download). Serves the production build, loads every plate cold, waits for convergence,
// and records the backend (WebGPU or WebGL2 fallback), tier, labels, console errors and a screenshot.
//
//   npm run build && node tools/capture/firefox.mjs  [path to firefox.exe]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const out = join(import.meta.dirname, 'output', 'firefox');
mkdirSync(out, { recursive: true });
const FIREFOX = process.argv[2] ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const PORT = 4323;
const BIDI = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 400 || r.status === 404) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const preview = spawn('npm', ['run', 'preview', '-w', '@atlas/site', '--', '--port', String(PORT)], { cwd: root, shell: true, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'atlas-ff-'));
writeFileSync(join(profile, 'user.js'), ['user_pref("remote.active-protocols", 1);', 'user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("datareporting.policy.dataSubmissionEnabled", false);', 'user_pref("browser.aboutwelcome.enabled", false);', 'user_pref("browser.startup.homepage_override.mstone", "ignore");'].join('\n'));
const firefox = spawn(FIREFOX, ['-no-remote', '-profile', profile, `--remote-debugging-port=${BIDI}`, '-width', '1600', '-height', '1100', 'about:blank'], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();
const events = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const results = { date: new Date().toISOString(), browser: '', plates: [] };
try {
  await waitFor(`http://localhost:${PORT}/`);
  await waitFor(`http://127.0.0.1:${BIDI}/json`, 30_000).catch(() => sleep(3000));
  ws = new WebSocket(`ws://127.0.0.1:${BIDI}/session`);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.type === 'error' ? p.reject(new Error(`${msg.error}: ${msg.message}`)) : p.resolve(msg.result);
    } else if (msg.method === 'log.entryAdded') events.push(msg.params);
  };
  const session = await send('session.new', { capabilities: {} });
  results.browser = `${session.capabilities.browserName} ${session.capabilities.browserVersion}`;
  await send('session.subscribe', { events: ['log.entryAdded'] });
  const { contexts } = await send('browsingContext.getTree', {});
  const context = contexts[0].context;
  await send('browsingContext.setViewport', { context, viewport: { width: 1600, height: 1000 } });
  const evaluate = async (expression) => (await send('script.evaluate', { expression, target: { context }, awaitPromise: true })).result?.value;

  await send('browsingContext.navigate', { context, url: `http://localhost:${PORT}/`, wait: 'complete' });
  const ids = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-plate]')].map((e) => e.id))`));
  // FF_PLATES=face,bed limits the pass to some plates (look development); the default is all of them.
  const only = process.env.FF_PLATES ? new Set(process.env.FF_PLATES.split(',')) : null;
  for (const [i, id] of ids.entries()) {
    if (only && !only.has(id)) continue;
    events.length = 0;
    await send('browsingContext.navigate', { context, url: `http://localhost:${PORT}/?capture=1&cold=${Date.now()}#${id}`, wait: 'complete' });
    const t0 = Date.now();
    let converged = false;
    while (Date.now() - t0 < 90_000) {
      if ((await evaluate(`document.body.dataset.converged ?? ''`)) === String(i)) {
        converged = true;
        break;
      }
      if (await evaluate(`document.body.classList.contains('static')`)) break;
      await sleep(400);
    }
    const state = JSON.parse(await evaluate(`JSON.stringify({ backend: document.body.dataset.backend ?? null, tier: document.body.dataset.tier ?? null, static: document.body.classList.contains('static'), gpu: 'gpu' in navigator, labels: document.querySelectorAll('.labels li').length })`));
    const shot = await send('browsingContext.captureScreenshot', { context });
    writeFileSync(join(out, `${id}.png`), Buffer.from(shot.data, 'base64'));
    const errors = events.filter((e) => e.level === 'error').map((e) => e.text?.slice(0, 4000));
    results.plates.push({ id, converged, ms: Date.now() - t0, ...state, errors });
    console.log(id, converged ? 'converged' : 'NOT converged', `${Date.now() - t0} ms`, JSON.stringify(state), errors.length ? `errors: ${errors.length}` : '');
  }
  await send('session.end', {}).catch(() => {});
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 2) + '\n');
  ws?.close();
  firefox.kill();
  preview.kill();
  // Astro keeps its preview server alive past the npm wrapper; stop it by name.
  spawnSync('npx', ['astro', 'preview', 'stop'], { cwd: join(root, 'apps/site'), shell: true, stdio: 'ignore' });
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
