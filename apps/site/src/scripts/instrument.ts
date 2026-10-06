/**
 * The instrument (plan §4): the viewer takes the model in hand at any plate. It is an override layer on top of the
 * authored state, never a second timeline:
 *   - the depth dial ghosts or hides a tissue family;
 *   - orbit and zoom buttons (the same moves as dragging, for WCAG 2.5.7);
 *   - a click or tap on a structure opens its card;
 *   - in the Explore chapter, operation controls: which resection, how far it has gone, the incision line and the
 *     closure barrier, all driving the same scene state the narrative uses.
 * Plate changes put the depth dial and the operation back to the authored scene; scrolling returns the camera.
 */
import type { SceneState } from '@atlas/timeline';
import type { Stage } from '@atlas/stage';
import { applyOperation, type OperationControls } from './operation.ts';

type Depth = 'essentials' | 'anatomy' | 'clinical';

export interface StructureRecord {
  id: string;
  names: { plain: string; anatomical: string; latin?: string };
  tissue: string;
  gloss?: string;
  role?: string;
  matters?: string;
  claims?: string[];
  members?: string[];
}

export interface InstrumentContext {
  stageEl: HTMLElement;
  canvas: HTMLCanvasElement;
  getStage(): Stage | null;
  structures: readonly StructureRecord[];
  getDepth(): Depth;
  openEvidence(ids: readonly string[]): void;
  markDirty(): void;
  /** Return the camera to the authored pose (also clears the orbit and zoom the buttons made). */
  resetCamera(): void;
  /** The instrument opened or closed: the label column gives way to it. */
  onToggle(open: boolean): void;
}

export interface Instrument {
  isOpen(): boolean;
  /** Orbit and zoom limits for the current plate: narrow around the authored pose, wide in the Explore chapter. */
  limits(): { az: number; el: number; zoomMin: number; zoomMax: number };
  /** The scene state after the viewer's operation controls (Explore only); the argument is not kept. */
  override(state: SceneState): SceneState;
  /** A plate has settled: the dial and the operation go back to the authored scene. */
  onPlate(chapter: string): void;
  /** A click or tap on the canvas at (x, y) in CSS pixels of the stage. */
  pickAt(x: number, y: number, width: number, height: number): void;
  refreshCard(): void;
  /** True when the viewer has changed something the authored scene did not (the reset control shows). */
  changed(): boolean;
}

const FAMILIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'skin', label: 'Skin' },
  { key: 'fat', label: 'Fat' },
  { key: 'fascia', label: 'Fascia' },
  { key: 'gland', label: 'Gland' },
  { key: 'duct', label: 'Duct' },
  { key: 'tumour', label: 'Tumour' },
  { key: 'nerve', label: 'Nerves' },
  { key: 'artery', label: 'Arteries' },
  { key: 'vein', label: 'Veins' },
  { key: 'muscle', label: 'Muscle' },
  { key: 'bone', label: 'Bone' },
];
const LEVELS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Off', value: 0 },
  { label: 'Faint', value: 0.25 },
  { label: 'On', value: 1 },
];
const RESECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'none', label: 'None: the whole gland' },
  { id: 'ecd', label: 'Extracapsular dissection' },
  { id: 'partial', label: 'Partial superficial' },
  { id: 'superficial', label: 'Superficial' },
  { id: 'total', label: 'Total, nerve kept' },
];
const BARRIERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'smas', label: 'SMAS flap' },
  { id: 'scm', label: 'Neck-muscle strip' },
  { id: 'graft', label: 'Graft sheet' },
];

const ORBIT_STEP = 12;

export function mountInstrument(ctx: InstrumentContext): Instrument {
  const ops: OperationControls = { active: false, resection: 'superficial', incision: 'blair', barrier: 'none', progress: 0 };
  let exploring = false;
  let selected: string | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'instrument-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'instrument');
  toggle.textContent = 'Manipulate Model'; // one label in both states: aria-expanded carries open and closed

  const panel = document.createElement('aside');
  panel.id = 'instrument';
  panel.className = 'instrument';
  panel.setAttribute('aria-label', 'Instrument');
  panel.hidden = true;
  panel.innerHTML = `
    <header><h2 tabindex="-1">Instrument</h2><button type="button" class="inst-close" aria-label="Close the instrument">×</button></header>
    <section class="inst-card" aria-live="polite"><p class="inst-hint">Click or tap a structure in the picture to ask about it.</p></section>
    <fieldset class="inst-depth"><legend>Depth</legend></fieldset>
    <div class="inst-view" role="group" aria-label="View">
      <span class="inst-label">View</span>
      <button type="button" data-view="left" aria-label="Turn the view to the left">◀</button>
      <button type="button" data-view="right" aria-label="Turn the view to the right">▶</button>
      <button type="button" data-view="up" aria-label="Tilt the view up">▲</button>
      <button type="button" data-view="down" aria-label="Tilt the view down">▼</button>
      <button type="button" data-view="in" aria-label="Move closer">+</button>
      <button type="button" data-view="out" aria-label="Move away">−</button>
    </div>
    <fieldset class="inst-op" hidden>
      <legend>The operation</legend>
      <div class="inst-row"><span class="inst-label">Operation</span><div class="inst-radios" data-group="resection"></div></div>
      <label class="inst-row"><span class="inst-label">How far it has gone</span><input type="range" min="0" max="100" value="0" data-op="progress" /><output>0%</output></label>
      <div class="inst-row"><span class="inst-label">Skin line</span><div class="inst-radios" data-group="incision"></div></div>
      <div class="inst-row"><span class="inst-label">Closure layer</span><div class="inst-radios" data-group="barrier"></div></div>
      <p class="inst-note">Modified Blair and facelift lines are both drawn as planned lines; the flap in the model is cut along the Blair path whichever is chosen. The closure layers appear once the specimen is out.</p>
    </fieldset>
    <button type="button" class="inst-reset">Back to the authored scene</button>`;
  ctx.stageEl.append(toggle, panel);

  const card = panel.querySelector<HTMLElement>('.inst-card')!;
  const depthBox = panel.querySelector<HTMLFieldSetElement>('.inst-depth')!;
  const opBox = panel.querySelector<HTMLFieldSetElement>('.inst-op')!;
  const resetBtn = panel.querySelector<HTMLButtonElement>('.inst-reset')!;

  // Depth dial: one segmented group per tissue family.
  for (const f of FAMILIES) {
    const row = document.createElement('div');
    row.className = 'inst-row';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', f.label);
    row.innerHTML = `<span class="inst-label">${f.label}</span><span class="inst-radios">${LEVELS.map((l, i) => `<label><input type="radio" name="dial-${f.key}" value="${l.value}"${i === 2 ? ' checked' : ''}><span>${l.label}</span></label>`).join('')}</span>`;
    depthBox.append(row);
  }
  const radios = (group: string, list: ReadonlyArray<{ id: string; label: string }>, current: string) => {
    const host = panel.querySelector<HTMLElement>(`[data-group="${group}"]`)!;
    host.setAttribute('role', 'radiogroup');
    host.innerHTML = list.map((o) => `<label><input type="radio" name="op-${group}" value="${o.id}"${o.id === current ? ' checked' : ''}><span>${o.label}</span></label>`).join('');
  };
  radios('resection', RESECTIONS, ops.resection);
  radios('incision', [{ id: 'blair', label: 'Modified Blair' }, { id: 'facelift', label: 'Facelift' }], ops.incision);
  radios('barrier', BARRIERS, ops.barrier);
  const progress = opBox.querySelector<HTMLInputElement>('input[data-op="progress"]')!;
  const progressOut = opBox.querySelector<HTMLOutputElement>('output')!;

  // ── Open and close ────────────────────────────────────────────────────────────────────
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    ctx.stageEl.classList.toggle('instrument-open', open);
    ctx.onToggle(open);
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden === true));
  panel.querySelector('.inst-close')!.addEventListener('click', () => {
    setOpen(false);
    toggle.focus();
  });
  panel.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      setOpen(false);
      toggle.focus();
      e.stopPropagation();
    }
  });

  // ── Depth dial ────────────────────────────────────────────────────────────────────────
  depthBox.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const stage = ctx.getStage();
    if (!stage || input.type !== 'radio') return;
    const key = input.name.replace('dial-', '');
    const v = Number(input.value);
    if (v >= 1) delete (stage.dial as Record<string, number>)[key];
    else (stage.dial as Record<string, number>)[key] = v;
    ctx.markDirty();
    refreshReset();
  });

  // ── View buttons ──────────────────────────────────────────────────────────────────────
  const limits = () => (exploring ? { az: 100, el: 70, zoomMin: 0.45, zoomMax: 2.2 } : { az: 35, el: 25, zoomMin: 0.7, zoomMax: 1.5 });
  panel.querySelector('.inst-view')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
    const stage = ctx.getStage();
    if (!b || !stage) return;
    const lim = limits();
    const o = stage.override;
    switch (b.dataset.view) {
      case 'left': o.azimuth = Math.max(-lim.az, o.azimuth - ORBIT_STEP); break;
      case 'right': o.azimuth = Math.min(lim.az, o.azimuth + ORBIT_STEP); break;
      case 'up': o.elevation = Math.min(lim.el, o.elevation + ORBIT_STEP); break;
      case 'down': o.elevation = Math.max(-lim.el, o.elevation - ORBIT_STEP); break;
      case 'in': o.zoom = Math.max(lim.zoomMin, o.zoom / 1.2); break;
      case 'out': o.zoom = Math.min(lim.zoomMax, o.zoom * 1.2); break;
    }
    ctx.markDirty();
    refreshReset();
  });

  // ── Operation controls ────────────────────────────────────────────────────────────────
  opBox.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    ops.active = true;
    if (input.name === 'op-resection') ops.resection = input.value;
    else if (input.name === 'op-incision') ops.incision = input.value;
    else if (input.name === 'op-barrier') ops.barrier = input.value;
    ctx.markDirty();
    refreshReset();
  });
  progress.addEventListener('input', () => {
    ops.active = true;
    ops.progress = Number(progress.value);
    progressOut.textContent = `${ops.progress}%`;
    ctx.markDirty();
    refreshReset();
  });

  const clearOps = () => {
    ops.active = false;
    ops.progress = 0;
    ops.resection = 'superficial';
    ops.incision = 'blair';
    ops.barrier = 'none';
    progress.value = '0';
    progressOut.textContent = '0%';
    for (const [name, value] of [['op-resection', 'superficial'], ['op-incision', 'blair'], ['op-barrier', 'none']] as const) {
      const r = opBox.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
      if (r) r.checked = true;
    }
  };
  const clearDial = () => {
    const stage = ctx.getStage();
    if (stage) for (const k of Object.keys(stage.dial)) delete (stage.dial as Record<string, number>)[k];
    for (const f of FAMILIES) {
      const r = depthBox.querySelector<HTMLInputElement>(`input[name="dial-${f.key}"][value="1"]`);
      if (r) r.checked = true;
    }
  };
  const changed = () => {
    const stage = ctx.getStage();
    return ops.active || !!Object.keys(stage?.dial ?? {}).length || !!stage?.override.azimuth || !!stage?.override.elevation || stage?.override.zoom !== 1;
  };
  const refreshReset = () => {
    resetBtn.hidden = !changed();
  };
  resetBtn.addEventListener('click', () => {
    clearOps();
    clearDial();
    selected = null;
    const stage = ctx.getStage();
    if (stage) stage.selected = null;
    ctx.resetCamera();
    showCard(null);
    ctx.markDirty();
    refreshReset();
    // The button hides itself now that nothing is changed; keep the keyboard inside the panel (Escape closes it from here).
    panel.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true });
  });
  refreshReset();

  // ── Structure card ────────────────────────────────────────────────────────────────────
  const byId = new Map(ctx.structures.map((s) => [s.id, s]));
  function showCard(id: string | null) {
    card.replaceChildren();
    if (!id || !byId.has(id)) {
      const p = document.createElement('p');
      p.className = 'inst-hint';
      p.textContent = 'Click or tap a structure in the picture to ask about it.';
      card.append(p);
      return;
    }
    const s = byId.get(id)!;
    const depth = ctx.getDepth();
    const h = document.createElement('h3');
    h.textContent = depth === 'essentials' ? s.names.plain : s.names.anatomical;
    card.append(h);
    if (depth === 'clinical' && s.names.latin) {
      const l = document.createElement('p');
      l.className = 'latin';
      l.textContent = s.names.latin;
      card.append(l);
    }
    const add = (label: string, text?: string) => {
      if (!text) return;
      const p = document.createElement('p');
      const b = document.createElement('strong');
      b.textContent = label;
      p.append(b, ` ${text}`);
      card.append(p);
    };
    if (depth !== 'essentials' && s.names.plain !== s.names.anatomical) add('Plainly:', s.names.plain);
    add('', s.gloss);
    add('What it does:', s.role);
    add('Why it matters here:', s.matters);
    if (s.claims?.length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inst-evidence';
      b.textContent = s.claims.length > 1 ? `Evidence (${s.claims.length} statements)` : 'Evidence';
      b.addEventListener('click', () => ctx.openEvidence(s.claims!));
      card.append(b);
    }
  }

  // ── The operation as scene state (operation.ts) ───────────────────────────────────────
  const override = (state: SceneState): SceneState => applyOperation(state, ops);

  return {
    isOpen: () => !panel.hidden,
    limits,
    override,
    changed,
    onPlate(chapter: string) {
      const wasExploring = exploring;
      exploring = chapter === 'explore';
      opBox.hidden = !exploring;
      if (!exploring && (wasExploring || ops.active)) clearOps();
      // A new plate returns the dial to the authored scene (the instrument stays open if the viewer has it open).
      clearDial();
      selected = null;
      const stage = ctx.getStage();
      if (stage) stage.selected = null;
      showCard(null);
      refreshReset();
    },
    pickAt(x, y, w, h) {
      const stage = ctx.getStage();
      if (!stage) return;
      const id = stage.pick(x, y, w, h);
      selected = id;
      stage.selected = id;
      if (panel.hidden) setOpen(true);
      showCard(id);
      ctx.markDirty();
    },
    refreshCard() {
      showCard(selected);
    },
  };
}
