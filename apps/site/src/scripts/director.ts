/**
 * Director: maps native scroll to timeline position t, evaluates the scene state, and drives the stage, labels,
 * gauge, live region and evidence drawer. Scrolling is never intercepted (plan §4). Accessibility rules
 * (CLAUDE.md): passive scrolling never moves focus; explicit navigation moves focus to the destination heading
 * once it has settled; only settled plates are announced, each once.
 */
import { compile, defaultStructure, evaluate, positionAt, restingY, scrollYAt, shouldDissolve, type PlateBand, type PlateSpec, type SceneState, type StructureState } from '@atlas/timeline';
import { updateGlyph } from './glyph.ts';
import { TierManager, type TierChoice } from './tiers.ts';

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
const LABEL_WIDTH = 230; // px reserved for the margin label column
const SVG_NS = 'http://www.w3.org/2000/svg';

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
  const initialState: SceneState = {
    camera: { azimuth: 0, elevation: 0, zoom: 1, frames: [] },
    structures: initialStructures,
    gauge: 0,
    op: {},
    variants: {},
    labels: [],
    light: { preset: 'studio', exposure: 1 },
  };
  let track = compile(data.plates, initialState);

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
  const glyph = document.querySelector<SVGSVGElement>('.orient');
  const qualitySelect = document.querySelector<HTMLSelectElement>('#quality');

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
  let tiers: TierManager | null = null;
  const hasGPU = 'gpu' in navigator;
  const hasWebGL2 = !!document.createElement('canvas').getContext('webgl2');
  // Static tier: no WebGPU or WebGL2, or asked for (?static): the captured figures carry the lesson.
  if ((!hasGPU && !hasWebGL2) || query.has('static')) document.body.classList.add('static');

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
    // Beside the text column the subject moves right; capture mode (figures, determinism) frames it centred.
    stage.frameOffsetX = r.width > r.height * 1.05 && !query.has('capture') ? 0.3 : 0;
    dirty = true;
  };

  (async () => {
    if (document.body.classList.contains('static')) return;
    try {
      const { Stage } = await import('@atlas/stage');
      // A tier forced by URL, or capture mode, is never changed automatically: captures stay deterministic.
      const forcedTier = query.get('tier') === 'mid' || query.get('tier') === 'high' ? (query.get('tier') as 'mid' | 'high') : null;
      const forced = !!forcedTier || query.has('capture');
      const stored = store.get('atlas.tier');
      const choice: TierChoice = forcedTier ?? (query.has('capture') ? 'high' : stored === 'high' || stored === 'mid' ? stored : 'auto');
      const s = new Stage({
        canvas,
        tier: choice === 'mid' ? 'mid' : 'high',
        forceWebGL: query.get('backend') === 'webgl' || !hasGPU,
        field: getComputedStyle(document.body).getPropertyValue('--field').trim() || '#252a28',
        structures: data.structures.map((s) => ({ id: s.id, tissue: s.tissue as never })),
      });
      await s.load('/assets/anatomy/slice.glb', '/assets/anatomy/frame.json');
      const tm = new TierManager(s, choice, forced, (tier, reason) => {
        document.body.dataset.tier = tier;
        document.body.dataset.tierReason = reason;
        dirty = true;
      });
      s.setTier(tm.initial());
      tiers = tm;
      document.body.dataset.tier = s.tier;
      document.body.dataset.backend = s.backend;
      if (qualitySelect) {
        qualitySelect.value = choice;
        qualitySelect.disabled = forced;
        qualitySelect.addEventListener('change', () => {
          store.set('atlas.tier', qualitySelect.value);
          tm.choose(qualitySelect.value as TierChoice);
        });
      }
      stage = s; // publish only once loaded: the frame loop checks `stage`
      if (import.meta.env.DEV) Object.assign(window, { __atlas: { stage: s, get track() { return track; }, evaluate, layoutLabels, get settledPlate() { return settledPlate; }, get current() { return current; }, targetT } });
      document.body.classList.add('scene-active');
      resize();
      canvas.dataset.ready = '1';
      performance.mark('atlas:ready'); // the scene is interactive (performance harness)
      canvas.dispatchEvent(new Event('atlas:ready'));
      await tm.warmUp();
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
  /** A leader: a dark halo under a light hairline, so it holds contrast over pale bone and dark muscle alike. */
  function leader(x1: number, y1: number, x2: number, y2: number) {
    for (const cls of ['halo', 'line']) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', cls);
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      leaders.append(line);
    }
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x1));
    dot.setAttribute('cy', String(y1));
    dot.setAttribute('r', '2.2');
    leaders.append(dot);
  }
  function labelItem(id: string, emphasis: string) {
    const { main, latin } = labelText(id);
    const li = document.createElement('li');
    li.dataset.structure = id;
    li.dataset.emphasis = emphasis; // read by the capture suite's contrast and luminance checks
    li.innerHTML = `${main}${latin ? `<span class="latin">${latin}</span>` : ''}`;
    labelsEl.append(li);
    return li;
  }
  /**
   * Landscape: one margin column to the right of the focus structures (never over them), sorted by height.
   * Portrait: a band of at most four labels along the bottom of the scene (plan §5).
   */
  function layoutLabels() {
    labelsEl.replaceChildren();
    leaders.replaceChildren();
    if (!stage || settledPlate < 0) return;
    const state = evaluate(track, settledPlate);
    const r = stageEl.getBoundingClientRect();
    const landscape = r.width > r.height;
    const max = landscape ? (depth === 'essentials' ? 4 : 6) : 4;
    const ids = [...state.labels].sort((a, b) => a.priority - b.priority).slice(0, max).map((l) => l.structureId);
    const proj = stage.projectAnchors(ids, r.width, r.height).filter((p) => p.visible && p.x > 8 && p.x < r.width - 8 && p.y > 8 && p.y < r.height - 8);
    if (landscape) {
      const focus = Object.entries(state.structures).filter(([, s]) => s.emphasis === 'focus' && s.presence > 0.5).map(([id]) => id);
      const box = stage.screenBox(focus, r.width, r.height);
      // The right margin, unless the focus reaches into it: then the gap between the text column and the focus.
      const textRight = document.querySelector('main')!.getBoundingClientRect().right;
      let columnX = r.width - LABEL_WIDTH;
      const left = !!box && box.right > columnX - 12 && box.left - LABEL_WIDTH - 36 > textRight;
      if (left) columnX = box!.left - LABEL_WIDTH - 36;
      proj.sort((a, b) => a.y - b.y);
      let bottom = 56 - LABEL_GAP; // first label no higher than just below the masthead
      for (const p of proj.filter((q) => (left ? q.x > columnX + LABEL_WIDTH + 16 : q.x < columnX - 16))) {
        const li = labelItem(p.id, state.structures[p.id]?.emphasis ?? 'context');
        if (left) li.style.right = `${r.width - columnX - LABEL_WIDTH}px`; // right-aligned against the focus side
        else li.style.left = `${columnX}px`;
        const h = li.offsetHeight; // two lines at Clinical depth (Latin name)
        const top = Math.max(p.y - 10, bottom + 6);
        if (top + h > r.height - 8) {
          li.remove();
          break;
        }
        li.style.top = `${top}px`;
        bottom = top + h;
        leader(p.x, p.y, left ? columnX + LABEL_WIDTH + 4 : columnX - 4, top + 10);
      }
    } else {
      // Rows of labels flowing left to right, stacked upward from the bottom edge of the scene.
      const items = proj.sort((a, b) => a.x - b.x).map((p) => {
        const li = labelItem(p.id, state.structures[p.id]?.emphasis ?? 'context');
        li.classList.add('band');
        li.style.maxWidth = `${r.width - 12}px`;
        return { p, li, w: li.offsetWidth, h: li.offsetHeight };
      });
      const rows: (typeof items)[] = [[]];
      let x = 6;
      for (const it of items) {
        if (x + it.w > r.width - 6 && rows.at(-1)!.length) {
          rows.push([]);
          x = 6;
        }
        rows.at(-1)!.push(it);
        x += it.w + 8;
      }
      let y = r.height - 8;
      for (const row of rows.reverse()) {
        const rowH = Math.max(...row.map((it) => it.h));
        y -= rowH;
        let rx = 6;
        for (const it of row) {
          it.li.style.left = `${rx}px`;
          it.li.style.top = `${y}px`;
          leader(it.p.x, it.p.y, rx + Math.min(it.w / 2, 24), y);
          rx += it.w + 8;
        }
        y -= 6;
      }
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
      tiers?.frame(now);
      updateGauge(state);
      const v = stage.view;
      updateGlyph(glyph, v.azimuth, v.elevation);
      lastApplied = current;
      document.body.dataset.t = current.toFixed(4); // the rendered position (reduced-motion check)
      dirty = false;
      converging = settledPlate >= 0;
    } else if (stage && converging && performance.now() >= fadeUntil) {
      converging = false;
      await stage.settle();
      layoutLabels();
      document.body.dataset.converged = String(settledPlate); // readiness signal for tests and captures
      if (!performance.getEntriesByName('atlas:converged').length) performance.mark('atlas:converged');
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

  // Director's console: development builds only (plan §8); never part of the production bundle.
  if (import.meta.env.DEV) {
    void import('./console.ts').then(({ mountConsole }) =>
      mountConsole({
        plates: data.plates,
        setDelta: (i, delta) => {
          const next = data.plates.map((p, k) => (k === i ? { ...p, delta } : p));
          track = compile(next, initialState);
          data.plates[i] = next[i]!;
          dirty = true;
        },
        current: () => current,
        scrubTo: (t) => scrollTo({ top: scrollYAt(t, bands) - readingLine(), behavior: 'auto' }),
        camera: () => {
          const st = evaluate(track, current);
          const o = stage?.override ?? { azimuth: 0, elevation: 0, zoom: 1 };
          return { azimuth: st.camera.azimuth + o.azimuth, elevation: st.camera.elevation + o.elevation, zoom: st.camera.zoom * o.zoom, frame: st.camera.frames.at(-1)?.ids ?? [] };
        },
      }),
    );
  }
}
