# Final presentation pass — status

_Resume here. Backup of the pre-pass build: git tag `pre-final-pass`, built site in `.backup/pre-final-pass-dist/` (ignored)._

## Completed phase
1 Baseline (screenshots `tools/capture/output/baseline/`, perf baseline `docs/perf/baseline.json`).

## Current phase
2–4 Exterior geometry, materials, environment and lighting (in progress).
- Exterior: MPFB adult-male macro (CC0) fitted as before; exterior body (neck, shoulders, chest) below the scene cut; short hair and brows as shells; regional skin tint (`pipeline/anatomy/exterior.py`, presentation only, checked: hair clear of the parotid region and the ear).
- Materials: per-family mesostructure in `packages/stage/src/materials.ts` (`detail()`), fibre axis `_AXIS` baked at export.
- Light: looks portrait/studio/operative/specimen blended by `light.mix` (timeline); studio PMREM; cyclorama background; field `#1d1f22` (ADR-0005 pending).

## Release blockers
- P0 Firefox: tumour shader fails WGSL validation (STATUS.md Next 1) — recheck after the material rewrite.
- P1 to verify: neck seam ridge, hairline quality, opening composition, localisation contour (not built yet).

## Approved visual benchmarks
None yet (opening, localisation, nerve/operative hero, Explore).

## Performance
Baseline (pre-pass, RTX 3070, Chrome): High 59.9 fps median, p95 16.8 ms (1600×1000 and 2538×1440); Mid p95 33.4 ms; cold load 5.17 MB, first plate converged 8.4 s.

## Next concrete action
Check the rebuilt asset on plates face / where-parotid; fix the seam and hairline; then compose the opening shot.
