/**
 * Director's console (development builds only; plan §8): scrub t, read the resolved camera including any
 * instrument-mode orbit, and edit the current plate's delta live, then copy it back into steps/*.mdx as YAML.
 * Toggle with the ` key, or open with ?console. Never shipped: loaded behind import.meta.env.DEV.
 */
import { stringify } from 'yaml';
import type { PlateSpec } from '@atlas/timeline';

export interface ConsoleHost {
  plates: PlateSpec[];
  /** Replace a plate's delta and recompile the track (throws on an invalid delta). */
  setDelta(i: number, delta: PlateSpec['delta']): void;
  current(): number;
  scrubTo(t: number): void;
  camera(): { azimuth: number; elevation: number; zoom: number; frame: readonly string[] };
}

export function mountConsole(host: ConsoleHost): void {
  const panel = document.createElement('aside');
  panel.className = 'dev-console';
  panel.setAttribute('aria-label', "Director's console (development)");
  panel.innerHTML = `
    <header><strong>Director's console</strong> <span class="dc-t"></span><button type="button" class="dc-close" aria-label="Close">×</button></header>
    <label>t <input type="range" class="dc-scrub" min="0" max="${host.plates.length - 1}" step="0.01" /></label>
    <pre class="dc-camera"></pre>
    <button type="button" class="dc-copy-camera">Copy camera YAML</button>
    <label>Plate delta (JSON)<textarea class="dc-delta" rows="14" spellcheck="false"></textarea></label>
    <div class="dc-actions"><button type="button" class="dc-apply">Apply</button><button type="button" class="dc-copy-delta">Copy delta YAML</button></div>
    <p class="dc-msg" role="status"></p>`;
  document.body.append(panel);
  const $ = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  const scrub = $<HTMLInputElement>('.dc-scrub');
  const delta = $<HTMLTextAreaElement>('.dc-delta');
  const msg = $<HTMLParagraphElement>('.dc-msg');
  let editing = -1;

  const cameraYaml = () => {
    const c = host.camera();
    // the flow style the steps use: camera: { azimuth: .., elevation: .., zoom: .., frame: [..] }
    return `camera: { azimuth: ${+c.azimuth.toFixed(1)}, elevation: ${+c.elevation.toFixed(1)}, zoom: ${+c.zoom.toFixed(2)}, frame: [${c.frame.join(', ')}] }`;
  };
  const refresh = () => {
    const t = host.current();
    $<HTMLSpanElement>('.dc-t').textContent = `t = ${t.toFixed(3)} · ${host.plates[Math.round(t)]?.id ?? ''}`;
    if (document.activeElement !== scrub) scrub.value = String(t);
    $<HTMLPreElement>('.dc-camera').textContent = cameraYaml();
    const i = Math.round(t);
    if (i !== editing && document.activeElement !== delta) {
      editing = i;
      delta.value = JSON.stringify(host.plates[i]!.delta, null, 2);
    }
    if (!panel.hidden) requestAnimationFrame(refresh);
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = `${what} copied.`;
    } catch {
      msg.textContent = `Clipboard unavailable; ${what} logged to the console.`;
      console.log(text);
    }
  };
  scrub.addEventListener('input', () => host.scrubTo(Number(scrub.value)));
  $<HTMLButtonElement>('.dc-copy-camera').addEventListener('click', () => copy(cameraYaml(), 'Camera'));
  $<HTMLButtonElement>('.dc-apply').addEventListener('click', () => {
    try {
      host.setDelta(editing, JSON.parse(delta.value));
      msg.textContent = `Plate ${host.plates[editing]!.id} updated (not saved to disk).`;
    } catch (err) {
      msg.textContent = `Not applied: ${(err as Error).message}`;
    }
  });
  $<HTMLButtonElement>('.dc-copy-delta').addEventListener('click', () => copy(stringify({ delta: host.plates[editing]!.delta }), 'Delta'));
  $<HTMLButtonElement>('.dc-close').addEventListener('click', () => (panel.hidden = true));
  addEventListener('keydown', (e) => {
    if (e.key !== '`' || (e.target as HTMLElement).closest('input, textarea')) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) requestAnimationFrame(refresh);
  });
  panel.hidden = !new URLSearchParams(location.search).has('console');
  if (!panel.hidden) requestAnimationFrame(refresh);
}
