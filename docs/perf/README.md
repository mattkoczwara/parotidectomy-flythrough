# Performance and browser reports

M1 measurements on the real slice (533k triangles, GLB 3.6 MB).

- **Machine:** RTX 3070 8 GB, driver 617.14.
- **Chrome:** via Playwright's `chrome` channel.
- **Firefox:** 156.0.1, over WebDriver BiDi.
- **Produced by:** `npm run perf` and `node tools/capture/firefox.mjs` (see `tools/capture/README.md`).

**Frame pacing** (`m1-report.json`, 2026-09-29), scrolling through every transition with the scene rendering every frame:

| Configuration | Median fps | p95 frame |
|---|---|---|
| High, WebGPU, 1600×1000 | 59.9 | 16.8 ms |
| High, WebGPU, 2560×1440 canvas (device scale 1.5) | 59.9 | 16.8 ms |
| Mid, WebGL2, CPU throttled 4× | 59.9 | 16.8 ms |

These are pinned at the 60 Hz display's vsync. They meet plan §14: at least 60 fps median with p95 under 20 ms on High, and at least 30 fps on Mid.

The GPU cannot be throttled here, so Mid-class hardware (Iris Xe, iPhone 13, Pixel 7) is approximated by CPU throttling, not measured. Real low-end devices remain to be tested.

**Cold load on an emulated 50 Mbps / 20 ms link:**

| Measure | Result | Budget |
|---|---|---|
| Transferred | 4.1 MB | 8 MB initial payload |
| Text readable | 0.19 s | — |
| Scene interactive | 1.25 s | under 3 s |
| First plate converged | 3.2 s | — |

The first plate converges after 64 anti-aliasing frames.

**Firefox 156** (`firefox-m1.json`): all 10 plates run on the WebGPU backend at High tier and converge, with labels and no console errors. Rendering matches Chrome visually.

**Portrait (390×844):**
- the scene is sticky at the top, and the text lane passes behind it;
- labels sit in a band of up to 4, which passes the legibility checks.

Safari and real mobile hardware are not available here.
