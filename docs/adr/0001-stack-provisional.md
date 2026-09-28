# ADR-0001: Web stack (renderer provisional)

- **Status:** Accepted for site, tooling and timeline. The renderer is **provisional** until the M0 renderer spike passes.
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
- No three.js dependency exists until the spike.
- Spike results are appended here: pass or fail per criterion, versions and hardware.
