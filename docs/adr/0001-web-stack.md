# ADR-0001: Web stack

- **Status:** Accepted. **Renderer locked 2026-09-28** after the M0 spike passed (results below).
- **Date:** 2026-09-28

## Context
The atlas is a scroll-controlled, deterministic 3D dissection. Every plate's text must be server-rendered and work without WebGL. The scene needs all of the following at once:
- custom tissue materials;
- nested transparency;
- clipping with cut caps;
- deforming tissue;
- post-processing (AO, TRAA);
- deterministic capture;
- a WebGL2 fallback.

three.js still labels `WebGPURenderer` experimental, and WebGPU is not yet Baseline in every major browser.

## Decision
- **Site:** Astro (static output, MDX content collections) with one scene island in vanilla TypeScript. No UI framework.
- **Astro version:** the plan named Astro 6. **Astro 7.3.5**, the current stable release at bootstrap, was used instead; nothing in the plan depends on 6-specific behaviour.
- **Timeline:** a custom, pure `packages/timeline`. No GSAP, Lenis or smooth-scroll library.
- **Schemas:** zod 4 in `packages/schema`, shared by the content collections, the pipeline and the validators.
- **Tests:** Vitest 5 now; Playwright is added in M0 for the spike's capture tests.
- **TypeScript 6.x:** TypeScript 7 (native) is out, but Astro's tooling peer range stops at 6.
- **Renderer (provisional):** three.js r186 `WebGPURenderer` with its automatic WebGL2 fallback, and TSL node materials. React Three Fiber is not used; v10 and its WebGPU path are still alpha.

## Lock condition
The M0 spike (plan §0) must pass on both WebGPU and forced WebGL2:
- ghosted gland over nerve;
- a cut surface with its cap;
- the baked-field peel, scrubbed both ways;
- a TSL tissue material;
- the non-emissive focus contour;
- GTAO and TRAA;
- under 0.5% pixel difference between cold-load, forward-scrub and backward-scrub captures;
- frame-time budget on the RTX 3070 and on throttled Mid.

**If it fails,** evaluate these before scene code depends on the renderer:
- a WebGL2 `WebGLRenderer` with TSL;
- Babylon.js 9;
- a partly prerendered strategy for the failing feature.

`packages/stage` sits behind `resolve(semantic) → RenderState`, so the timeline and content layers are unaffected either way.

## Consequences
- three.js is pinned at **0.186.1** (`three/webgpu`, `three/tsl`). Upgrades are deliberate, in their own commits, and rerun the spike suite.
- The spike lives in `spikes/renderer` and stays runnable as a regression harness until `packages/stage` supersedes it: `npm run spike -w @atlas/spike-renderer`.

## M0 renderer spike results (2026-09-28)

**Setup:**
- Hardware: RTX 3070 8 GB, Windows 10.
- Browser: Chrome 154 (headed, GPU), driven by Playwright 1.63.
- Viewport: 2560×1440 at DPR 1.
- Proxy scene, about 97k triangles:
  - skin and fat slabs;
  - a lobulated superficial lobe (split at the nerve plane) and a deep lobe;
  - a tumour;
  - the facial nerve (trunk, divisions, five branch groups) at true relative calibre;
  - the retromandibular vein.
- Raw data: `spikes/renderer/output/results.json` (gitignored). Rerun with `npm run spike -w @atlas/spike-renderer`.

| Criterion | WebGPU High | Forced WebGL2 High | WebGL2 Mid | Result |
|---|---|---|---|---|
| Backend actually used | webgpu | webgl2 | webgl2 | pass |
| Ghosted gland over nerve | single-layer ghost: 0 px flicker at rest | same | same (blended) | pass, **with the changed technique** (below) |
| Cut surface with `frontFacing` cap (custom clip in `maskNode`) | clean caps on lobe and tumour | same | same | pass |
| Baked-field peel, scrubbed both ways | no tearing after the hinge fix | same | same | pass |
| TSL tissue material (SSS, clearcoat, sheen) | compiles and renders | same | same | pass. The look is M1 look-development work. |
| Non-emissive focus contour | `OutlineNode` visible edge mixed toward tissue luminance | same | same | pass |
| GTAO + TRAA | on | on | FXAA, no AO | pass |
| Determinism (cold load vs forward vs backward scrub, 5 plates) | worst 0.013% of pixels | worst 0.000% | worst 0.000% | pass (limit <0.5%) |
| Backend parity (WebGPU vs WebGL2, High) | — | worst 0.007% of pixels | — | pass |
| GPU time, ghosted plate while orbiting | median 1.70 ms, p95 3.25 ms | median 2.33 ms, p95 4.98 ms | median 1.39 ms, p95 3.73 ms | pass |
| Frame interval, uncapped, no timestamp readback | median 2.1 ms, p95 3.1 ms | median 2.0 ms, p95 3.9 ms | median 1.3 ms, p95 2.9 ms | pass |
| Mid tier at 1080p under 4× CPU throttle | — | — | median 6.5 ms, p95 9.1 ms | pass (≥30 fps) |

**Findings that change technique (not stack):**
1. **Alpha-hash ghosting is rejected.** Even after TRAA converges, alpha-hash leaves visible stipple, and 0.17% of pixels still change between frames at rest. The single-layer blend is stable (0%): a depth-only twin mesh draws first, then the tissue blends over the already-drawn opaque interior. It needs no per-mesh sorting, and nested structures are handled by anatomical render order. **It is adopted for every tier.** Plan §8 is updated.
2. **The peel hinge sits on the lobe's lateral surface, not on the nerve plane.** A deep-face hinge folds the lateral surface through itself (confirmed on a cross-section grid: 153 inverted cells). A lateral-surface hinge gives zero inversions at every progress value, and it matches the surgical motion: the lobe is reflected anteriorly with its deep face turning up. A full reflection of about 130° pushes the lobe outside the skin envelope of the proxy. The real scene must keep the skin flap elevated, or move the specimen out of the field, before full reflection.
3. **Contour hidden edges stay off by default.** Drawing the nerve through opaque tissue reads as an unexplained x-ray. They may only be used where a plate explicitly explains them.
4. **r186 gotchas:**
   - Khronos Neutral tone mapping's toe crushes the dark field, so the field colour is pre-compensated.
   - `renderOutput()` into FXAA produced zero alpha, so the output is forced opaque.
   - `RenderPipeline.renderAsync()` is deprecated: `await renderer.init()`, then call `render()`.
   - TRAA settles deterministically when captures start at jitter phase 0 and render 64 frames. **Each of those frames must be its own animation frame** (found in the integrated review, 2026-10-04): the scene passes, the AO and the TRAA resolve are per-frame nodes, which three r186 updates once per `requestAnimationFrame` tick (`nodeFrame.frameId`, advanced by the renderer's own animation loop). A loop of 64 `render()` calls in one task is therefore one accumulation step, and the picture then depends on how many live frames preceded it (0.5-0.9% of pixels on the edge-heavy plates, and an unanti-aliased picture after the first interaction). `Stage.settle` now renders one frame per animation tick and is cancellable.
   - Vertex-shader deformation produces no motion vectors, so TRAA can trail slightly during a peel scrub. This is not visible at rest.

**Not yet proven (carried into M1):**
- Performance at real geometry scale. The proxy is 97k triangles against a High budget of ≤2.5M. The GPU headroom (about 1.7 ms per frame) makes this low risk, but it is re-measured on the real slice.
- Real mobile and Safari hardware. This machine can only emulate those tiers.
