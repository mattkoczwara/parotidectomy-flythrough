# Final presentation pass — status

_Pre-pass backup: git tag `pre-final-pass`; built site in `.backup/pre-final-pass-dist/` (ignored). Decisions:
ADR-0005. Benchmarks: `docs/benchmarks/` (`node tools/capture/benchmarks.mjs`, `--approve <id>`)._

## Completed phase
All phases (1 baseline → 10 release validation). Release criteria met on the reference machine; the pass is closed.

## Current phase
None. Next project work is clinical review (`docs/STATUS.md`).

## Remaining release blockers
None known (P0/P1). Deferred P2, judged to be at diminishing return:
- Skin is idealised and smooth at close range (no pore map, by design); the hairline is crisp at close range.
- The raised flap's underside reads brownish in shadow; small fat flecks at its torn edge; a small notch at its front
  edge (the band's front limit).
- The neck and shoulders follow the donor's heavy neck (coupled to the anatomy fit).
- The loading poster's framing differs from the live framing by a few per cent (crossfaded).
- Mid tier p95 about 36 ms under 4× CPU throttle (33.4 ms before, at a 60 Hz cadence); first convergence ~9.3 s on a
  cold load (the poster covers it).

## Approved visual benchmarks
`opening` (face), `localisation` (where-parotid), `nerve-operative` (bed), `explore` — final versions 2026-10-05.

## Performance (RTX 3070, Chrome, `docs/perf/m5-report.json`)
- Final: every measure within tolerance of the M5 baseline. High tier median 56.5 fps, p95 18.1 ms at 1600×1000 and
  1440p; payload 5.61 MB; scene interactive 1.94 s; first plate converged 9.30 s.
- The display paced at about 56 Hz in the final runs (a blank page: 18 ms); the scene met every vsync. At 60 Hz
  earlier the same build measured 59.9 fps, p95 16.8 ms.
- Procedural shader noise had cost 15 s of shader compile (first picture 19.7 s); the baked noise volume removed it.

## Validation (final state)
Capture suite 25/25 (determinism cold/forward/backward, labels, axe WCAG 2.2 AA, focus, reduced motion, static
tier, print); Firefox 157: 54/54 plates, no console errors; forced WebGL2 renders every hero; two clean anatomy
builds byte-identical; 27/27 anatomy checks; `npm test` 38/38; `validate` ok.

## Next concrete action
Clinical review (STATUS.md item 2). For further look development: `snap.mjs --ui`, `benchmarks.mjs`,
`exterior_only.sh`.
