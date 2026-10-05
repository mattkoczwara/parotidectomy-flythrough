# Final presentation pass — status

_Pre-pass backup: git tag `pre-final-pass`; built site in `.backup/pre-final-pass-dist/` (ignored). Decisions:
ADR-0005. Benchmarks: `docs/benchmarks/` (`node tools/capture/benchmarks.mjs`, `--approve <id>`). Clinical-review
manifest of every geometry change: `docs/qc/final-pass-clinical-manifest.md`._

## Completed phase
All phases (1 baseline → 10 release validation), then the acceptance pass (2026-10-05): clinical change audit,
performance clarification and the final visual defect review. The visual production is frozen.

## Current phase
None. Next project work is clinical review (`docs/STATUS.md`).

## Acceptance pass (2026-10-05)
- **Audit:** seven geometry changes are listed with their checks and review needs in the manifest. One defect was
  found and fixed: MakeHuman's mouth lining, deepened by the adult base, lay across the donor CT in plate 15 and
  beside the deep lobe in plate 43 and the operative wound. It is now trimmed to 8 mm behind the face surface and
  capped. The outer skin is unchanged. The `nerve-operative` benchmark was re-approved for that reason; the others
  differ by ≤ 0.3% of pixels.
- **Visual defects** (A = P1, fix; B = acceptable P2; C = anatomically driven, keep):
  - Idealised, smooth skin at close range: **B** (no pore or ageing map by design; the atlas does not linger on the
    skin).
  - Crisp hairline at close range: **B** (shell hair; reads correctly at every authored framing).
  - Brownish underside of the raised flap: **B**, partly **C** (the underside is fat, as in a real skin-fat flap; the
    brown is its shadowed tone under the camera-relative fill).
  - Small cream flecks along the flap edge: **B** (the fat's cut face along the torn edge). The flap's front notch,
    a sliver where the fat band ends, was present before the pass too: **B**.
  - Heavy neck and shoulders: **C** above the scene cut (the upper neck is fitted to the donor's CT, a heavy-set
    man); **B** below it (generic shoulders).
  - No A items. Nothing was changed for these.

## Remaining release blockers
None in production (P0/P1). Public release is blocked by clinical review, and Safari and real mobile hardware are
untested (see the release report in `docs/STATUS.md`). Deferred P2: the items above, the loading poster's framing
offset of a few per cent (crossfaded), Mid tier p95 about 36 ms under 4× CPU throttle, and first convergence
~9.3 s on a cold load (the poster covers it).

## Approved visual benchmarks
`opening` (face), `localisation` (where-parotid), `nerve-operative` (bed; re-approved 2026-10-05), `explore`.

## Performance (RTX 3070, Chrome)
- Vsync-paced (`npm run perf`, `docs/perf/m5-report.json`): every measure within tolerance of the M5 baseline.
  Final run (2026-10-05 17:24, 60 Hz): High 59.9 fps, p95 16.8 ms at 1600×1000 and 1440p; Mid (WebGL2, CPU 4×)
  p95 33.4 ms; cold load 5.35 MB, scene interactive 2.03 s (+24.5%, close to its 25% flag; budget 3 s), first plate
  converged 9.77 s.
- Headroom with vsync off (`docs/perf/uncapped.json`): CPU interval per rendered frame 4.1 ms median (1600×1000);
  GPU 4.5 ms per frame at 1600×1000 and 6.9 ms at 1440p while its queue is saturated (medians), about 3.7× and 2.4×
  a 60 Hz frame. No GPU p95 is available from this method.
- The display paces at 56–57 Hz on this machine in recent runs (a static page: 17.4–18 ms); the paced runs met every
  refresh.

## Validation (final state, after the audit fix)
Two clean anatomy builds byte-identical (`178db28f…`); 27/27 anatomy checks; capture suite 25/25 (determinism
cold/forward/backward, labels, axe WCAG 2.2 AA, focus, reduced motion, static tier, print) on regenerated figures;
Firefox 157: 54/54 plates converge on WebGPU with no console errors (`docs/perf/firefox-final.json`); the forced
WebGL2 check of every hero was made before the fix (shaders unchanged by it); benchmarks compared (above).

## Next concrete action
Clinical review (STATUS.md item 2), starting with the manifest's items 3, 4 and 7.
