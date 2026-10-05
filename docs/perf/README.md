# Performance and browser reports

Measurements are kept so that a later run can be compared with an earlier one.

| File | What it is |
|---|---|
| `baseline.json` | The reference run (M5, 54 plates). `npm run perf` compares each run with it. Replace it only on purpose: copy `m5-report.json` over it after a change that is meant to move the numbers, and say why in `STATUS.md`. |
| `m5-report.json` | The latest `npm run perf` run, including a `vs_baseline` section (each watched measure, its change, and a flag when it got worse by more than its tolerance). |
| `history/` | A copy of every run, named by its date. Never edited. |
| `firefox-m5.json` | The Firefox pass over all 54 plates (`node tools/capture/firefox.mjs`). |
| `firefox-final.json` | The Firefox pass over all 54 plates after the final presentation pass (Firefox 157, WebGPU): every plate converges with no console errors. |
| `uncapped.json` | Render headroom with vsync off (`node tools/capture/uncapped.mjs`): CPU interval per rendered frame and GPU throughput while its queue is saturated. See the last section. |
| `hitch-before.json`, `hitch-after.json` | Plate-transition hitches over two warmed traversals each (`npm run hitch`), before and after the 2026-10-05 runtime fix. See the last section. |
| `hitch-probe-before.json`, `hitch-probe-after.json` | The attribution runs behind that fix (WebGPU resource creation and app timings per stall). They perturb timing, so their frame numbers are not acceptance figures. |
| `capture-m5.json` | What the capture suite measured on the same build: determinism, label legibility, accessibility, and which tests passed. |
| `m1-report.json`, `firefox-m1.json` | The M1 slice (10 plates), kept for the record. |

**To compare a future run.** Run `npm run perf`. It prints one line per watched measure (`ok` or `WORSE`, baseline, now, change) and stores the same comparison in `m5-report.json`. The watched measures and tolerances are in `tools/capture/tests/perf.spec.ts`: median fps (10% lower), p95 frame time (20% higher), payload (10% higher), scene-interactive time and first-plate-converged time (25% higher). The comparison flags a change and does not fail the run, because frame times depend on the machine: compare runs on the same machine, display and driver, and read the `gpu` and `date` fields.

## M5 baseline (54 plates)

- **Machine:** RTX 3070 8 GB, driver 617.14, a 60 Hz display, Chrome via Playwright's `chrome` channel.
- **Scene:** 630k triangles, GLB 4.58 MB, 62 meshes.
- **Produced by:** `npm run perf`, commit `6be1cf9`, 2026-10-04.

**Frame pacing**, scrolling through every transition of all 54 plates with the scene rendering every frame while it moves:

| Configuration | Frames | Median fps | p95 frame |
|---|---|---|---|
| High, WebGPU, 1600×1000 | 7,648 | 59.9 | 16.8 ms |
| High, WebGPU, 2538×1440 canvas (device scale 1.5) | 7,452 | 59.9 | 16.8 ms |
| Mid, WebGL2, CPU throttled 4× | 6,759 | 59.9 | **33.4 ms** |

High is pinned at the display's vsync and meets plan §14 (at least 60 fps median, p95 under 20 ms). Mid meets "at least 30 fps" on the median; its p95 of 33.4 ms means the slowest 5% of frames are at the 30 fps line. In M1 (10 plates, a lighter scene) the same configuration measured 16.8 ms, so the Mid tier now has no margin under 4× CPU throttling. The GPU cannot be throttled here, so Mid-class hardware (Iris Xe, iPhone 13, Pixel 7) is approximated by CPU throttling, not measured.

**Cold load on an emulated 50 Mbps / 20 ms link, cache disabled:**

| Measure | Result | Budget |
|---|---|---|
| Transferred | 5.17 MB | 8 MB initial payload |
| Text readable | 0.28 s | none |
| Scene interactive | 1.63 s | under 3 s |
| First plate converged | 8.4 s | none |

The first plate is converged late because a cold load builds every shader of the scene and the post-processing chain once: two main-thread stalls of about 2 s and 3 s (measured in a trace of the frames), after which the picture accumulates for about 96 animation frames. The text is readable from 0.28 s. Removing the `compileAsync` pre-warm (it built the same shaders twice) took the first-plate time from 11.2 s to 8.4 s. Reducing the one-time build further (sharing material graphs between meshes of one tissue family) is not done.

**Settled pictures.** The settled picture of a plate is identical (0 pixels differ at the capture threshold) whether it is reached by a cold load, forward scrolling or backward scrolling. This depends on `Stage.settle` rendering one frame per animation frame (ADR-0001, r186 gotchas).

**Firefox 157** (`firefox-m5.json`, run 2026-10-04): all 54 plates converged on the WebGPU backend at High tier, but 33 plates report a WGSL validation error for one fragment shader and the tumour is not drawn (plate 12 shows the label with no tumour). This is an open defect, listed first under Next in `STATUS.md`; a future run of `node tools/capture/firefox.mjs` should be compared with this file and should report no errors.

**Portrait (390×844):** the scene is sticky at the top and the text lane passes behind it; labels sit in a band of up to 4 (the label checks pass in landscape and portrait for all 54 plates).

Safari and real mobile hardware are not available here.

## M1 record (10 plates, 2026-09-29)

High 59.9 fps with p95 16.8 ms at 1600×1000 and at 2560×1440; Mid WebGL2 with 4× CPU throttle 59.9 fps with p95 16.8 ms; cold load 4.1 MB, scene interactive in 1.25 s, first plate converged in 3.2 s; Firefox 156.0.1 ran all 10 plates on WebGPU at High.

## Final presentation pass (2026-10-05)

Same machine and display. `npm run perf` against the M5 baseline (kept as the reference; every measure within
tolerance): High 59.9 fps, p95 16.8 ms at 1600×1000 and at 1440p; Mid (WebGL2, CPU 4×) p95 33.4 ms (unchanged);
cold load 5.57 MB (+7.7%), scene interactive 2.0 s, first plate converged 9.35 s (+10.7%). The history holds the
intermediate run with procedural shader noise (1440p p95 33.4 ms, first plate 19.7 s) that led to the baked noise
volume (ADR-0005). `node tools/capture/coldload.mjs` separates main-thread stalls from GPU shader compilation on a
cold load.

**Display pacing caveat (2026-10-05, later runs).** The last runs measured a median of 56 fps and p95 of 18.1 ms in
every configuration. A blank page in the same browser measured the same 18 ms frame interval, so the display or
compositor was pacing at about 56 Hz rather than 60 Hz. The scene still met every vsync. Bisecting (the previous
asset, the stage code of the earlier run, no loading poster) gave identical numbers. Compare runs only at the same
refresh rate; check a blank page's rAF interval first.
History entries 2026-10-05T09-57, 10-01 and 10-04 are single-test bisect runs (the previous asset, no poster, the
earlier stage code); `m5-report.json` is the last full run on the final code (2026-10-05T09-45).

## Render headroom above the refresh rate (acceptance, 2026-10-05)

The vsync-paced runs above show that the scene met every refresh interval. They cannot show how much of each interval
was spare. `node tools/capture/uncapped.mjs` (one-off, `uncapped.json`) runs the same scroll through all 54 plates with
Chrome's vsync and frame-rate limit off. It wraps `GPUQueue.submit` from the test page; no project code changes.

| Configuration | CPU: interval between rendered frames (median, p95) | GPU: ms per frame while its queue is saturated (median) |
|---|---|---|
| High, WebGPU, 1585×1000 canvas | 4.1 ms, 8.5 ms | 4.5 ms |
| High, WebGPU, 2538×1440 canvas | 3.8 ms, 14.5 ms | 6.9 ms |

How to read it:
- Uncapped, the page submits frames faster than the GPU finishes them, so GPU work queues up (submit-to-done p95 is
  0.3–0.8 s of queueing, not render time). The rendered-frame interval is therefore the CPU's cost per frame.
- The GPU figure counts frames completed per 250 ms in bins where at least three submitted frames were still
  outstanding, so the GPU never waited for work. It is the GPU's throughput: about 220 frames per second at
  1600×1000 and 145 at 1440p, roughly 3.7× and 2.4× a 16.7 ms frame.
- It has no reliable p95: completion callbacks arrive in batches, and a shader compile stalls single bins. Tail
  frames are covered by the vsync-paced p95 above.
- One machine (RTX 3070) only. It says nothing about Mid-class GPUs, which cannot be emulated here.
- A static page in the same session paced at 57 Hz (17.4 ms): the display was again running below 60 Hz.

## Plate-transition hitches (runtime fix, 2026-10-05)

`npm run hitch` (`tools/capture/tests/hitch.spec.ts`) is a lightweight detector. It uses the perf walk: High,
1600×1000, 22 px wheel steps over all 54 plates. One traversal warms the page, then two are measured on the same page.
It records each animation frame's interval with the rendered timeline position, plus long animation frames and long
tasks. A stall is a frame over 40 ms. It is "recurring" when the other run stalls in the same transition and progress
band (±0.1). With `HITCH_PROBE=1` it also counts WebGPU resource creation per stall. That run is for attribution only.

**Before** (`hitch-before.json`; both runs were already warmed):
- 59 and 52 frames over 40 ms; max 767 and 717 ms.
- About 52 long tasks per run; 33 of 53 transitions had a stall.
- The same transitions stalled at the same progress in both runs, for example contour→pathology at 0.2 (767/717 ms),
  healing→compl-map at 0.6 (667/600 ms) and no-shelling→ultrasound at 0.5 (384/400 ms).

**Causes found**
1. **Mid-transition stalls: material rebuilds.** `setOpacity` toggled `transparent`/`depthWrite` and set
   `needsUpdate` whenever a structure crossed opacity 0.999. three then rebuilt that node material for every pass,
   with new WGSL, shader modules, pipelines and bind groups. It did so on every crossing, including states already
   seen. The probe showed render time in the stall frame rising about 20–25 ms per flip (36 flips: 824 ms), with
   `apply()` under 1 ms. There were 1,963 WebGPU creations in a warmed traversal.
   **Fix:** each tissue has a prebuilt ghost twin of its material (same node graph and uniforms; transparent, no depth
   write), and `setOpacity` swaps materials. Both keep their pipelines, so a crossing costs nothing. WebGPU creations
   in a warmed traversal fell from 1,963 to 45 (the TRAA history reseed per settle).
2. **Stalls at plate arrival: label occlusion raycasts.** `layoutLabels` → `projectAnchors` raycast every opaque
   occluder's triangles for each label, up to 180 ms at a settled plate, twice per settle. **Fix:** `occlusion.ts`
   `anyHit` uses the same triangle test, sidedness and near/far. It skips 256-triangle chunks whose cached bounds the
   ray misses. Its hits are identical to `Mesh.raycast` (unit test on 2,400 random rays). Label layout now takes at
   most 15 ms.

**After** (`hitch-after.json`, two warmed runs):

| | Run 1 | Run 2 |
|---|---|---|
| Frames | 9,064 | 9,441 |
| Median / p95 | 16.7 / 16.8 ms | 16.7 / 16.8 ms |
| Max frame | 33 ms | 17 ms |
| Over 25 ms / over 40 ms | 1 / 0 | 0 / 0 |
| Long tasks / long animation frames | 0 / 0 | 0 / 0 |
| Transitions with a stall | 0 | 0 |

Every transition's local p95 is 16.8 ms. The worst transition maximum is 33 ms (one frame, ultrasound→cross-section,
run 1 only). The first visit to a state on a cold load still builds its pipelines once; that is outside this measure.
