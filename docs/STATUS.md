# Project status

_Last updated: 2026-10-04 (M2–M5 implemented and verified in Chrome; Firefox follow-up and clinical review are next)_

## Current phase

**M2–M5 implementation complete, verified in Chrome. One Firefox defect is open.** The owner authorised progression beyond M1 (2026-10-04) to an implementation-complete private-use application. That authorisation does not resolve M1's exceptions, answer the owner's comprehension questions or constitute clinical sign-off. **Clinical review remains after implementation; public launch is blocked on it.**

All 54 plates in 11 chapters are authored, rendered and reviewed as one sequence (contact sheets of the committed static figures, and the live site under the capture suite).

## Next, in order

1. **Firefox: the tumour is not drawn.** Firefox 157 (WebGPU, High) converged on all 54 plates (`docs/perf/firefox-m5.json`, screenshots in `tools/capture/output/firefox/`), but 33 of the 54 plates report console errors: one fragment shader fails WGSL validation (`Entry point main at Fragment is invalid`, `fragment:666:1041`) and its pipeline (`MeshPhysicalNodeMaterial_40`) is invalid, so that surface is not drawn. The colour constants in the failing expression are those of the `tumour` tissue preset, and the tumour is visibly missing on plate 12 (`pseudocapsule`: the label "The tumour" points at empty tissue). Chrome (Tint) accepts the same shader. M1's Firefox pass (156.0.1, 10 plates) had no errors, so this came in with M2–M5 (the tumour material gained the global clip mask and the piece/variant options). The report truncates the validator's reason. To do: log the full message, find the construct Naga rejects in `packages/stage/src/materials.ts` (`tissue()`), fix it without changing Chrome's picture, rerun `node tools/capture/firefox.mjs`, and check the other Firefox plates by eye. Also run the forced-WebGL2 path (`?backend=webgl`) over all 54 plates; only the Mid-tier scroll run has exercised it.
2. **Clinical review** of the 68 claims, the anatomy QC log and the review packet (`docs/review/index.html`, regenerated). Deferred by owner decision until implementation was complete.
3. **Evidence items to verify before any public use** (see Open questions).

## Where things are

| Area | Location | Notes |
|---|---|---|
| Plates (54, 11 chapters) | `apps/site/src/content/steps/NN-id.mdx` | The MDX files are the source of truth. |
| Claims (68), sources (71), structures (77), assets (11), glossary (41) | `apps/site/src/content/*` | Every claim is `verification: checked` (wording and numbers compared with fetched source text) and `clinicalReview: pending`. 30 key structures carry a role and a "why it matters" that are the verbatim wording of a claim they cite. |
| Working plan, decisions, checklist | `docs/m2-m5-implementation.md`, `docs/adr/0004-…` | Pieces/groups, continuous variants, hatch grammar, ink, insets, imaging, explorer. |
| Timeline | `packages/timeline` | Pure state, variants, groups, shared `RESECTION_EXTENT`. |
| Stage | `packages/stage` | Pieces and resections, SMAS fold, neck-muscle strip turn, CT plane with global clip, overlay planes, zones, ochre schematics, picking. `Stage.settle` is the deterministic settled picture (ADR-0001). |
| Instrument and Explore controls | `apps/site/src/scripts/instrument.ts`, `operation.ts` | Depth dial, orbit/zoom buttons, structure card, operation controls (a pure function with tests). |
| Pipeline | `pipeline/anatomy/*.py`, `pipeline/specs/anatomy.yaml`, `pipeline/build/` | `npm run anatomy`: 26 anatomy checks gate the export; two clean runs give a byte-identical `slice.glb`; it ends by updating asset checksums. |
| Validators | `tools/validate` | Schema, references, retraction blocklist, paragraph attribution, glTF node and checksum checks, glossary drift, `--public` gate. |
| Capture and look-development tools | `tools/capture` | The Playwright suite, `snap.mjs` (contact sheets, `--patch`, `--clean`), `compare.mjs`, `firefox.mjs`. |
| Measurements kept for later runs | `docs/perf/` | `baseline.json`, `m5-report.json`, `history/`, `capture-m5.json`, `firefox-m5.json`; see its README. |

Commands: `npm run dev`, `build`, `test`, `typecheck`, `validate`, `validate:public`, `build:public`, `check`, `capture` (figures, rebuild, then the suite; about 55 minutes), `perf` (about 10 minutes; compares with `docs/perf/baseline.json`), `review`, `anatomy`.

Dev note: after rewriting step files, touch them or restart the dev server; the content watcher can miss a second write made seconds after the first. Restart it after a schema change.

## Verification results (2026-10-04, commit `6be1cf9`)

Chrome with WebGPU on one RTX 3070, a 60 Hz display.

- **`npm run check`:** typecheck clean; 38 unit tests pass; validate ok (268 files, 71 sources, 68 claims, 77 structures, 11 assets, 41 glossary entries, 54 plates; 0 claims to verify; 68 awaiting clinical review); build ok.
- **`npm run capture`: 25 of 25 pass** (`docs/perf/capture-m5.json`).
  - Determinism: a cold load, forward scrolling and backward scrolling give pixel-identical settled pictures on all 54 plates (0 pixels differ; the criterion is under 0.5%).
  - Labels, all 54 plates, landscape and portrait: at most 5 and 4 labels, no overlaps, none outside the scene, text contrast at least 6.13:1 (needs 4.5), leader contrast at least 5.04:1 (needs 3), focus structures at least 17.9 L* above the field (needs 15).
  - Accessibility (axe-core, WCAG 2.2 A and AA): 0 violations on the atlas, with the instrument open, with the evidence drawer open, in the static tier, and on the method, credits and glossary pages; headings in order, every plate an article with a heading, description and figure.
  - Focus and announcements: passive scrolling moves no focus and announces nothing unsettled; explicit navigation focuses the destination heading once settled; reduced motion renders plateau states only; the static tier carries a figure and description for every plate; print drops the scene and keeps text, figures and notes.
  - Instrument: opens by keyboard, the dial and view buttons change and restore the picture, a click gives a structure card, the Explore controls drive the scene and reset it, the narrow-screen sheet works.
- **`npm run perf`** (`docs/perf/baseline.json`): High 59.9 fps median, p95 16.8 ms at 1600×1000 and at 2538×1440 over all 54 plates; Mid (WebGL2, CPU throttled 4×) 59.9 fps median but **p95 33.4 ms**, at the 30 fps line with no margin (M1: 16.8 ms); cold load on 50 Mbps: 5.17 MB (budget 8 MB), text readable 0.28 s, scene interactive 1.63 s (budget 3 s), first plate converged 8.4 s (a one-time shader build of about 5 s, then about 96 animation frames of accumulation).
- **Firefox 157:** see Next, item 1.

### Defects the verification found and fixed

- `Stage.settle` rendered its 64 accumulation frames in one task, but three updates the scene passes, AO and TRAA once per animation frame, so the settled picture depended on the path to it (up to 0.75% of pixels on edge-heavy plates) and lost its anti-aliasing after the first interaction. It now renders one frame per animation frame, is cancellable, and starts only after the tier warm-up (ADR-0001).
- The Explore chapter's operation controls mutated the timeline's cached authored state, so "Back to the authored scene" left the specimen out. `applyOperation` now copies (test added).
- The ultrasound probe's label anchor fell on empty field (now on the probe's lateral face); the compare plate no longer labels level III, whose face is hidden in the exploded view.
- Resetting the view or the instrument dropped keyboard focus to the page; it now moves to a control that stays visible.
- The anatomy build did not stop on a failed check, and alternate tumours could sit within 2 mm of the skin: a skin-cover constraint, a documented accessory-lobule exclusion and `check_all.py` as a gate before export.
- Glossary definitions had drifted from re-grounded claims: regenerated, with a drift validator and `tools/evidence/syncglossary.ts`.
- Accessibility: definition-list structure, target sizes and faint-ink contrast on the reference pages.

## Known limits (to carry into the final report)

See `/method/` for the reader-facing list. In short: the tragal-pointer distance (about 19 mm) is outside both published ranges (reported, not tuned); the facial nerve cannot be checked against the cryosections; the superficial share (59%) and the ESGS level shares (I 8%, II 51%, III 30%, IV 10% against published 20–22, 41–47, 20–22, 8–10) differ from published figures (reported, not tuned); layers are constant-depth bands; the flap is a fold; the facelift line is a planned line only (the flap is cut along the Blair path whichever is chosen); total parotidectomy's inner-lobe delivery, barrier flaps, contour depth, saliva collection, Frey regrowth and recurrent nodules are schematic or illustrative; imaging shows the donor's normal CT plus an outline, with no ultrasound or MRI picture. In the compare plate (and the exploded views generally) a label can only point at a piece's visible face.

Hardware not tested: Safari, real phones and mid-class laptops (a CPU-throttled run stands in, and its p95 has no margin). Measured on one RTX 3070 with Chrome (full suite) and Firefox (convergence only, with the defect above).

## Open questions

- Clinical review of all 68 claims, the anatomy QC log and the review packet.
- Evidence items to verify before any public use: the primary source for the Milan 2nd-edition figures (`rossi-2024`), the Bernhard 2026 PMID, a primary citation for the Stensen's duct course, a source for the clear facial drape. StatPearls could not be fetched (a bot challenge, not bypassed); no claim rests on it.
- Where reports disagree and the atlas shows both: sialocele (9.1% at one centre against 4.5% and 3.1% pooled), facial weakness (3.75% to 29% across series), tragal-pointer distance.
- Whether to reduce the one-time shader build on a cold load (about 5 s, in two main-thread stalls of 2–3 s) by sharing material graphs between meshes of one tissue family; and whether the Mid tier needs a lighter material set for its 33.4 ms p95 under 4× throttling.

## History

M1 (vertical slice, ten plates) was delivered and measured on 2026-09-29: determinism at most 0.37% of pixels, High tier 59.9 fps with p95 16.8 ms, payload 4.1 MB, Firefox 156 matching Chrome. Its documented exceptions were the tragal-pointer distance, claims then marked to-verify, untested hardware and the owner's comprehension questions. Corrections made during M1 are in `docs/qc/QC_LOG.md`.

Environment: npm 9.1.2 with Node 24.16 (Astro prints a harmless engine warning); Astro 7.3.5 instead of Astro 6 (ADR-0001); `astro check` not added; pip's cache holds an unused 2.7 GB CUDA wheel.
