/**
 * Director: maps native scroll to timeline position t, evaluates the scene state, and drives the stage, labels,
 * gauge, live region and evidence drawer. Scrolling is never intercepted (plan §4). Accessibility rules
 * (CLAUDE.md): passive scrolling never moves focus; explicit navigation moves focus to the destination heading
 * once it has settled; only settled plates are announced, each once.
 */
import { compile, defaultStructure, evaluate, positionAt, restingY, shouldDissolve, type PlateBand, type PlateSpec, type SceneState, type StructureState } from '@atlas/timeline';

type Depth = 'essentials' | 'anatomy' | 'clinical';

interface ClientData {
  plates: Array<PlateSpec & { title: string; chapter: string; sceneDescription: string }>;
  structures: Array<{ id: string; names: { plain: string; anatomical: string; latin?: string }; tissue: string; depth: string }>;
  claims: Record<string, ClaimRecord>;
  sources: Record<string, SourceRecord>;
  planes: readonly string[];
}
interface ClaimRecord {
  id: string;
  statement: { essentials: string; anatomy?: string; clinical?: string };
  evidenceClass: string;
  sources: Array<{ sourceId: string; locator?: string; support: string }>;
  numbers: Array<{ label: string; value: number; unit: string; ci?: [number, number]; range?: [number, number]; n?: string; population: string; design: string; sourceId: string }>;
  limitations?: string;
  disagreement?: string;
  verification: string;
  clinicalReview: { status: string };
}
interface SourceRecord {
  id: string;
  citation: { authors: string[]; title?: string; container: string; year?: number; volume?: string; pages?: string };
  publicationType: string;
  pmid?: string;
  doi?: string;
  url?: string;
  status: string;
}

const LONG_JUMP = 1.5;
const SETTLE_MS = 220;
const LABEL_GAP = 30;

export function start(): void {
  const data = JSON.parse(document.getElementById('atlas-data')!.textContent!) as ClientData;
  const query = new URLSearchParams(location.search);
  if (query.has('capture')) document.body.classList.add('capture');
  // Look-development A/B of the field colour (ADR-0003); the decided field is the stylesheet default.
  if (query.get('field') === 'graphite' || query.get('field') === 'drape') document.body.dataset.field = query.get('field')!;
  const names = new Map(data.structures.map((s) => [s.id, s.names]));

  // Every content structure starts present, in context; plates record only what changes.
  const initialStructures: Record<string, StructureState> = {};
  for (const s of data.structures) initialStructures[s.id] = { ...defaultStructure };
  const track = compile(data.plates, {
    camera: { azimuth: 0, elevation: 0, zoom: 1, frames: [] },
    structures: initialStructures,
    gauge: 0,
    op: {},
    variants: {},
    labels: [],
    light: { preset: 'studio', exposure: 1 },
  });

  const articles = [...document.querySelectorAll<HTMLElement>('[data-plate]')];
  const headings = articles.map((a) => a.querySelector('h3') as HTMLElement);
  const live = document.querySelector<HTMLElement>('.live')!;
  const stageEl = document.querySelector<HTMLElement>('.stage')!;
  const canvas = document.querySelector<HTMLCanvasElement>('#stage-canvas')!;
  const labelsEl = document.querySelector<HTMLOListElement>('.labels')!;
  const leaders = document.querySelector<SVGSVGElement>('.leaders')!;
  const gaugeItems = [...document.querySelectorAll<HTMLElement>('.gauge li')];
  const railLinks = [...document.querySelectorAll<HTMLAnchorElement>('.rail a')];
  const resetBtn = document.querySelector<HTMLButtonElement>('.reset-view')!;

  // ── Preferences (per-viewer conveniences; storage may be unavailable) ──────────────────
  const store = {
    get: (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
  };
  let depth: Depth = (store.get('atlas.depth') as Depth) || 'essentials';
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const motionBox = document.querySelector<HTMLInputElement>('#reduce-motion')!;
  motionBox.checked = store.get('atlas.reduceMotion') === '1' || motionQuery.matches;
  const reducedMotion = () => motionBox.checked;
  motionBox.addEventListener('change', () => store.set('atlas.reduceMotion', motionBox.checked ? '1' : '0'));
  const setDepth = (d: Depth) => {
    depth = d;
    document.body.dataset.depth = d;
    store.set('atlas.depth', d);
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="depth"]')) r.checked = r.value === d;
    layoutLabels();
  };
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="depth"]')) r.addEventListener('change', () => setDepth(r.value as Depth));

  // ── Scroll → t ────────────────────────────────────────────────────────────────────────
  let bands: PlateBand[] = [];
  const readingLine = () => innerHeight * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reading-line') || '0.4');
  const measure = () => {
    bands = articles.map((a) => {
      const r = a.getBoundingClientRect();
      const top = r.top + scrollY;
      return { plateauStart: top, plateauEnd: top + Math.max(r.height, 1) };
    });
  };
  const targetT = () => positionAt(scrollY + readingLine(), bands);

  // ── Evidence drawer ───────────────────────────────────────────────────────────────────
  const dialog = document.querySelector<HTMLDialogElement>('dialog.evidence')!;
  const body = dialog.querySelector<HTMLElement>('.evidence-body')!;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const fmt = (n: ClaimRecord['numbers'][number]) => {
    const unit = n.unit === '%' ? '%' : ` ${n.unit}`;
    const bounds = n.ci ? ` (95% CI ${n.ci[0]}–${n.ci[1]}${unit})` : n.range ? ` (range ${n.range[0]}–${n.range[1]}${unit})` : '';
    return `<span class="value">${n.value}${unit}</span>${bounds}`;
  };
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.claim-ref');
    if (!btn) return;
    const c = data.claims[btn.dataset.claim!];
    if (!c) return;
    const text = depth === 'clinical' ? (c.statement.clinical ?? c.statement.anatomy ?? c.statement.essentials) : depth === 'anatomy' ? (c.statement.anatomy ?? c.statement.essentials) : c.statement.essentials;
    body.innerHTML = `
      <p>${esc(text)}</p>
      <p class="class">Evidence: ${esc(c.evidenceClass.replaceAll('-', ' '))}</p>
      ${c.numbers.map((n) => `<div class="figure"><div>${esc(n.label)}: ${fmt(n)}</div><div>${esc(n.population)}${n.n ? ` · ${esc(n.n)}` : ''}</div><div>${esc(n.design)} (${esc(data.sources[n.sourceId]?.citation.authors[0] ?? n.sourceId)} ${data.sources[n.sourceId]?.citation.year ?? ''})</div></div>`).join('')}
      ${c.disagreement ? `<p class="caveat">Disagreement: ${esc(c.disagreement)}</p>` : ''}
      ${c.limitations ? `<p>Limitations: ${esc(c.limitations)}</p>` : ''}
      <h3>Sources</h3>
      <ol class="sources">${c.sources
        .map((r) => {
          const s = data.sources[r.sourceId];
          if (!s) return '';
          const cit = s.citation;
          const link = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : s.doi ? `https://doi.org/${s.doi}` : s.url;
          return `<li>${esc(cit.authors.slice(0, 3).join(', '))}${cit.authors.length > 3 ? ' et al.' : ''} ${cit.year ?? ''}. ${cit.title ? esc(cit.title) + '. ' : ''}<i>${esc(cit.container)}</i>. ${esc(s.publicationType.replaceAll('-', ' '))}${r.support === 'indirect' ? ' (indirect support)' : ''}. ${link ? `<a href="${esc(link)}" rel="noreferrer">Link</a>` : ''}</li>`;
        })
        .join('')}</ol>
      <p class="status">Checked against sources: ${c.verification === 'checked' ? 'yes' : 'not yet'} · Clinical review: ${esc(c.clinicalReview.status)}</p>`;
    dialog.showModal();
  });

  // ── Stage (optional: the page is complete without it) ─────────────────────────────────
  type StageLike = import('@atlas/stage').Stage;
  let stage: StageLike | null = null;
  const hasGPU = 'gpu' in navigator;
  const hasWebGL2 = !!document.createElement('canvas').getContext('webgl2');
  if (!hasGPU && !hasWebGL2) document.body.classList.add('static');

  let current = 0; // rendered t
  let lastApplied = Number.NaN;
  let settledPlate = -1;
  let announcedPlate = -1;
  let stillSince = 0;
  let pendingFocus: number | null = null;
  let converging = false;
  let dirty = true;

  const resize = () => {
    if (!stage) return;
    const r = stageEl.getBoundingClientRect();
    stage.resize(r.width, r.height);
    stage.frameOffsetX = r.width > r.height * 1.05 ? 0.3 : 0;
    dirty = true;
  };

  (async () => {
    if (document.body.classList.contains('static')) return;
    try {
      const { Stage } = await import('@atlas/stage');
      const params = new URLSearchParams(location.search);
      const s = new Stage({
        canvas,
        tier: params.get('tier') === 'mid' ? 'mid' : 'high',
        forceWebGL: params.get('backend') === 'webgl' || !hasGPU,
        field: getComputedStyle(document.body).getPropertyValue('--field').trim() || '#252a28',
        structures: data.structures.map((s) => ({ id: s.id, tissue: s.tissue as never })),
      });
      await s.load('/assets/anatomy/slice.glb', '/assets/anatomy/frame.json');
      stage = s; // publish only once loaded: the frame loop checks `stage`
      if (import.meta.env.DEV) Object.assign(window, { __atlas: { stage: s, track, evaluate, layoutLabels, get settledPlate() { return settledPlate; }, get current() { return current; }, targetT } });
      document.body.classList.add('scene-active');
      resize();
      canvas.dataset.ready = '1';
      canvas.dispatchEvent(new Event('atlas:ready'));
    } catch (err) {
      console.error('3D scene unavailable; continuing with the text and static figures.', err);
      stage = null;
      document.body.classList.remove('scene-active');
      document.body.classList.add('static');
    }
  })();

  // ── Instrument mode: constrained orbit on drag; any scroll returns to the authored view ──
  let drag: { x: number; y: number; az: number; el: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!stage) return;
    drag = { x: e.clientX, y: e.clientY, az: stage.override.azimuth, el: stage.override.elevation };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !stage) return;
    stage.override.azimuth = Math.max(-35, Math.min(35, drag.az + (e.clientX - drag.x) * 0.25));
    stage.override.elevation = Math.max(-25, Math.min(25, drag.el - (e.clientY - drag.y) * 0.25));
    resetBtn.hidden = false;
    dirty = true;
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  const resetOverride = () => {
    if (!stage) return;
    stage.override.azimuth = 0;
    stage.override.elevation = 0;
    stage.override.zoom = 1;
    resetBtn.hidden = true;
    dirty = true;
  };
  resetBtn.addEventListener('click', resetOverride);

  // ── Explicit navigation (moves focus once the destination has settled) ────────────────
  const go = (i: number) => {
    const idx = Math.max(0, Math.min(articles.length - 1, i));
    pendingFocus = idx;
    scrollTo({ top: restingY(idx, bands) - readingLine(), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  document.querySelector('[data-nav="prev"]')!.addEventListener('click', () => go(Math.round(targetT()) - 1));
  document.querySelector('[data-nav="next"]')!.addEventListener('click', () => go(Math.round(targetT()) + 1));
  for (const a of railLinks) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const i = articles.findIndex((art) => `#${art.id}` === a.getAttribute('href'));
      history.replaceState(null, '', a.getAttribute('href'));
      go(i);
    });
  }
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, select, dialog')) return;
    if (e.key === 'j' || e.key === 'ArrowRight') go(Math.round(targetT()) + 1);
    else if (e.key === 'k' || e.key === 'ArrowLeft') go(Math.round(targetT()) - 1);
    else return;
    e.preventDefault();
  });

  // ── Labels: margin column with hairline leaders, laid out only when a plate has settled ──
  function labelText(id: string) {
    const n = names.get(id);
    if (!n) return { main: id, latin: '' };
    if (depth === 'essentials') return { main: n.plain, latin: '' };
    return { main: n.anatomical, latin: depth === 'clinical' ? (n.latin ?? '') : '' };
  }
  function layoutLabels() {
    labelsEl.replaceChildren();
    leaders.replaceChildren();
    if (!stage || settledPlate < 0) return;
    const state = evaluate(track, settledPlate);
    const r = stageEl.getBoundingClientRect();
    const max = r.width > r.height ? (depth === 'essentials' ? 4 : 6) : 4;
    const ids = [...state.labels].sort((a, b) => a.priority - b.priority).slice(0, max).map((l) => l.structureId);
    const proj = stage.projectAnchors(ids, r.width, r.height).filter((p) => p.visible && p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height);
    const columnX = r.width > r.height ? r.width - Math.min(260, r.width * 0.2) : r.width * 0.62;
    proj.sort((a, b) => a.y - b.y);
    let lastY = -Infinity;
    for (const p of proj) {
      const y = Math.max(p.y, lastY + LABEL_GAP);
      lastY = y;
      const { main, latin } = labelText(p.id);
      const li = document.createElement('li');
      li.innerHTML = `${main}${latin ? `<span class="latin">${latin}</span>` : ''}`;
      li.style.left = `${columnX}px`;
      li.style.top = `${y - 10}px`;
      labelsEl.append(li);
      const ns = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(columnX - 4));
      line.setAttribute('y2', String(y));
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
      dot.setAttribute('r', '2');
      leaders.append(line, dot);
    }
  }

  // ── Frame loop ────────────────────────────────────────────────────────────────────────
  let lastTime = performance.now();
  let lastTarget = 0;
  const frame = async (now: number) => {
    try {
      await step(now);
    } catch (err) {
      console.error('atlas frame error', err); // keep the loop alive; the text remains usable regardless
    }
    requestAnimationFrame(frame);
  };
  // Until this time the canvas is still fading back in from a dissolve; a plate is not converged before then.
  let fadeUntil = 0;
  const dissolveTo = async (t: number) => {
    canvas.classList.add('dissolving');
    await new Promise((r) => setTimeout(r, 160));
    current = t;
    dirty = true;
    requestAnimationFrame(() => canvas.classList.remove('dissolving'));
    const fade = parseFloat(getComputedStyle(canvas).transitionDuration) * 1000 || 0;
    stillSince = performance.now(); // the blank interval is not stillness
    fadeUntil = stillSince + fade + 50;
  };
  const step = async (now: number) => {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    const target = targetT();
    const plate = Math.round(target);

    if (reducedMotion()) {
      // Plateau states only, dissolving between plates (no camera flights).
      const next = Math.abs(target - plate) < 0.5 ? plate : Math.round(current);
      if (next !== current) await dissolveTo(next);
    } else if (shouldDissolve(current, target, false, LONG_JUMP)) {
      await dissolveTo(target);
    } else {
      // Critically damped follow toward the scroll target (never replaces native scroll).
      const k = 1 - Math.exp(-dt * 9);
      const next = Math.abs(target - current) < 0.0005 ? target : current + (target - current) * k;
      if (next !== current) dirty = true;
      current = next;
    }

    // Scrolling returns the view from instrument mode to the authored pose.
    if (Math.abs(target - lastTarget) > 1e-4 && stage && (stage.override.azimuth || stage.override.elevation)) {
      stage.override.azimuth *= 0.85;
      stage.override.elevation *= 0.85;
      if (Math.abs(stage.override.azimuth) < 0.2 && Math.abs(stage.override.elevation) < 0.2) resetOverride();
      dirty = true;
    }
    lastTarget = target;

    const atPlateau = Math.abs(target - plate) < 1e-6 && Math.abs(current - target) < 0.001;
    if (!atPlateau) {
      stillSince = now;
      if (settledPlate !== -1) {
        settledPlate = -1;
        stageEl.classList.add('moving');
        delete document.body.dataset.settled;
        delete document.body.dataset.converged;
      }
    } else if (settledPlate !== plate && now - stillSince > SETTLE_MS) {
      settledPlate = plate;
      onSettled(plate);
    }

    if (stage && (dirty || current !== lastApplied)) {
      const state = evaluate(track, current);
      stage.apply(state);
      stage.render();
      updateGauge(state);
      lastApplied = current;
      dirty = false;
      converging = settledPlate >= 0;
    } else if (stage && converging && performance.now() >= fadeUntil) {
      converging = false;
      await stage.settle();
      layoutLabels();
      document.body.dataset.converged = String(settledPlate); // readiness signal for tests and captures
    }
  };

  function onSettled(i: number) {
    stageEl.classList.remove('moving');
    const p = data.plates[i]!;
    canvas.setAttribute('aria-label', `Model: ${p.title}. ${p.sceneDescription}`);
    document.body.dataset.settled = String(i);
    delete document.body.dataset.converged;
    if (announcedPlate !== i) {
      live.textContent = `${p.title}. ${p.sceneDescription}`;
      announcedPlate = i;
    }
    for (const a of railLinks) a.setAttribute('aria-current', String(a.dataset.chapter === p.chapter));
    if (pendingFocus === i) {
      headings[i]!.focus({ preventScroll: true });
      pendingFocus = null;
    }
    converging = true;
    layoutLabels();
  }

  function updateGauge(state: SceneState) {
    const g = Math.round(state.gauge);
    gaugeItems.forEach((li, i) => li.classList.toggle('current', i === g));
  }

  // ── Start ─────────────────────────────────────────────────────────────────────────────
  setDepth(depth);
  measure();
  addEventListener('resize', () => {
    measure();
    resize();
  });
  new ResizeObserver(() => measure()).observe(document.querySelector('main')!);
  document.fonts?.ready.then(measure);
  // Deep link: rest on the plate directly, with no replay (the state is a pure function of t). Layout shifts as
  // webfonts and the scene arrive, so re-seat the link until the viewer scrolls for themselves.
  const hashIndex = articles.findIndex((a) => `#${a.id}` === location.hash);
  let viewerScrolled = false;
  for (const ev of ['wheel', 'touchmove', 'keydown', 'pointerdown']) addEventListener(ev, () => (viewerScrolled = true), { once: true, passive: true });
  const seat = () => {
    if (hashIndex < 0 || viewerScrolled) return;
    measure();
    scrollTo({ top: restingY(hashIndex, bands) - readingLine(), behavior: 'auto' });
    current = hashIndex;
    dirty = true;
  };
  if (hashIndex >= 0) seat();
  else current = targetT();
  document.fonts?.ready.then(seat);
  // In-page links to a plate (#id) are explicit navigation: go there and move focus once it settles.
  addEventListener('hashchange', () => {
    const i = articles.findIndex((a) => `#${a.id}` === location.hash);
    if (i >= 0) go(i);
  });
  addEventListener('load', seat);
  canvas.addEventListener('atlas:ready', seat);
  requestAnimationFrame(frame);
}
