# Final presentation pass — status

_Resume here. Pre-pass backup: git tag `pre-final-pass`; built site in `.backup/pre-final-pass-dist/` (ignored).
Decisions: ADR-0005. Benchmarks: `docs/benchmarks/` (`node tools/capture/benchmarks.mjs`)._

## Completed phases
1 Baseline · 2 Exterior geometry (adult MPFB macro, exterior body, hair/brows, tint, footprint) · 3 Materials (baked
noise volume, per-family mesostructure) · 4 Light and field (looks blended by `light.mix`, studio PMREM, cyclorama,
camera-relative fill, scene-cut fade) · 5 Hero compositions · 7 UI chrome (editorial restyle, label column clears
the gauge) · Firefox tumour shader (P0) fixed.

## Current phase
6/8/9/10: motion check, performance re-measure, whole-atlas consistency, release validation (capture suite, figures,
Firefox 54 plates, forced WebGL2).

## Remaining release blockers
- None known at P0. To confirm in the full capture suite: determinism, label legibility, accessibility after the CSS
  and field change.
- P1 watch: 1440p p95 (33.4 ms before the noise volume; re-measuring); cold load first picture ~9–10 s (baseline 8.4 s).
- P2: raised flap underside darkish in `flap`/`barrier-*` plates; hairline crisp at close range; Mid tier p95 33.4 ms
  under 4× CPU throttle (pre-existing).

## Approved visual benchmarks
`opening` (face), `localisation` (where-parotid), `nerve-operative` (bed), `explore` (explore) — 2026-10-05.

## Performance (RTX 3070, Chrome, 1600×1000 unless noted)
Pre-pass: High 59.9 fps / p95 16.8 ms (also at 1440p); Mid p95 33.4 ms; 5.17 MB; first plate converged 8.4 s.
After materials with procedural noise: 1440p p95 33.4 ms, first plate 19.7 s → baked noise volume: first plate
8.8–10.3 s (coldload.mjs).

## Next concrete action
Read the perf run; then `npm run capture` (figures + suite) and the full Firefox pass; fix what they find.
