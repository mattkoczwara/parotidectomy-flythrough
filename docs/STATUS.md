# Project status

_Last updated: 2026-09-29_

## Current phase

**M1 (vertical slice): implementation complete, pending owner acceptance.** The criteria not fully met are listed under "M1 acceptance".

- **Slice:** all ten plates of plan §12 and every system the plan lists for the slice.
- **Automated checks:** the plan §14 criteria are measured in the capture suite and the performance harness.
- **Clinical review:** deferred by owner decision (see "Open questions"). The review packet is generated and current.
- **Next:** M2 (anatomy, pathology and diagnosis; plan §11), after the owner accepts M1.

## M1 delivered

### Anatomy pipeline
Run it with `npm run anatomy`. Everything is built in the canonical CT frame (ADR-0002).

- Landmarks, and nerves and vessels authored from cited specs, with 12 topology and relationship checks.
- Segmented surfaces.
- An authored retromandibular deep portion:
  - it excludes muscle-density tissue beside the posterior digastric;
  - a new check reports that overlap at 1%.
- The nerve-plane lobe split.
- The tumour: 19 mm, with 1.6 mm of nerve clearance, and a 2.2 mm skin fullness over it.
- A generic MPFB (CC0) face.
- Fat, SMAS and capsule layers. The capsule is a smoothed 1 mm offset of the gland.
- **Incision and flap** (`pipeline/anatomy/flap.py`):
  - The modified Blair path is picked on the fitted skin.
  - Signed-distance, path and flap-weight fields are baked on the skin and fat, with conforming local refinement.
  - The fold is about an axis in front of the incision; the auricle is excluded.
- Output: 533k triangles; GLB 3.6 MB with meshopt.
- Every check passes (`docs/qc/m1-anatomy/checks.json`).

### Cryosection QC
(`pipeline/anatomy/cryo.py`, `docs/qc/m1-cryo/`)

- Three levels are registered locally.
- The authored RMV and ECA agree with the photographs to within 1–5 mm.
- The facial nerve cannot be resolved in the photographs.

### Stage (`@atlas/stage`)
three.js r186 `WebGPURenderer`, with a WebGL2 fallback.

- **Materials and rendering:**
  - tissue-family TSL materials;
  - terraced cutaway windows;
  - the single-layer ghost;
  - the peel;
  - a non-emissive focus contour;
  - GTAO + TRAA on High, FXAA on Mid.
- **Incision and flap:**
  - incision ink, drawn along the path;
  - the flap cut and folded by shader fields.
- **Tiers:** switching at run time.
- **Anchors and labels:**
  - Anchor occlusion accounts for windows, the opened incision, the peel and the fold (CPU mirrors of the shaders).
  - Focus bounds are projected on screen for label placement.
- **Settle and determinism:**
  - `settle()` waits for every pipeline to compile, aligns the jitter and reseeds the anti-aliasing history.
  - Deterministic plateau frames are verified in capture.

### Site (`apps/site`)

**Plates:** 10 plates in 5 chapters:
1. face
2. where the gland lies
3. layers
4. tumour
5. nerve within
6. nerve plane
7. incision marked
8. flap raised
9. finding the trunk
10. peel

**Director:**
- native scroll maps to t;
- plateaus and the damped follow;
- the long-jump dissolve;
- the reduced-motion mode renders only whole plates;
- only settled plates are announced;
- focus moves only on explicit navigation.

**Around the scene:**
- **Labels:** a margin column beside the focus in landscape; a band of up to 4 in portrait. Leaders have a dark halo, and labels wrap to the column.
- **Orientation glyph:** the head seen from above, with the viewer's position.
- **Plane gauge.**
- **Reading depth.**
- **Evidence drawer.**
- **Instrument orbit.**
- **Quality control:** Auto, High or Standard, stored per viewer.
- **Static tier:** used without WebGPU or WebGL2, or with `?static`. It now links its captured figures; the link lookup had been broken, which is fixed.
- **Capture mode:** frames the subject centred.

**Tier manager** (`scripts/tiers.ts`):
- Auto starts on High (on Mid under WebGL2).
- A 2 s warm-up keeps High only if p95 ≤ 20 ms.
- Sustained p95 above 34 ms steps down.
- Forced tiers never change.

**Director's console** (development only; the ` key or `?console`):
- scrub t;
- read the resolved camera, including orbit, and copy it as step YAML;
- edit a plate's delta live, and copy it back.

### Timeline
Per-key operative transition windows (`transition.opKeys`), with tests. `scrollYAt()` is the inverse of the scroll mapping.

### Look development (ADR-0003)
- The drape field `#252a28` (OKLCH L 0.279, C 0.008) was chosen over graphite after an A/B on real plates.
- Skin SSS was reduced, and the fat, muscle and fill light were adjusted.
- Gentian-violet ink is the only violet.

### Checks
**`npm run check`:** typecheck, 19 unit tests, validators and build. The validators check:
- step frontmatter;
- references;
- claims in the text;
- numbers with populations;
- provenance and the checksum.

**`npm run capture`:** 8 Playwright tests on the production build, all passing:
- static figures;
- determinism: every plate at most **0.37%** of pixels differ (limit 0.5%; tumour and nerve-within, previously at 0.47%, are now at most 0.37% and 0.32%);
- passive scrolling moves no focus and announces nothing;
- J/K focus;
- reduced motion;
- static tier;
- labels in landscape and portrait:
  - count;
  - overlap;
  - inside the scene;
  - text ≥ 4.5:1 (minimum measured 6.2);
  - leaders ≥ 3:1 (minimum 5.4);
  - focus ≥ 15 L\* above the field (minimum 18).

**`npm run perf`** (`docs/perf/`, for the RTX 3070):

| Configuration | Result |
|---|---|
| High, 1600×1000 | 59.9 fps median, p95 16.8 ms (vsync-bound) |
| High, 2560×1440 canvas | 59.9 fps median, p95 16.8 ms |
| Mid, WebGL2, CPU 4× | 59.9 fps median |
| Cold load | 4.1 MB; scene interactive in 1.25 s on 50 Mbps |

**Firefox 156** (`node tools/capture/firefox.mjs`, WebDriver BiDi): all 10 plates run on WebGPU at High, with labels and no console errors. It matches Chrome visually.

**Portrait (390×844):** the scene is sticky, the text lane passes behind it, and the label band passes the checks.

**Chrome share of the viewport:** 3.8% at 1600×1000 and 5.9% at 1280×800 (limit 10%).

**Review packet** (`npm run review`, giving `docs/review/index.html`):
- every plate's figure, text and scene description;
- its claims, with sources, numbers and status;
- the anatomy check results;
- the self-review checklist (`docs/review/checklist.json`).

## M1 acceptance (plan §14)

**Met:**
- **Determinism:** 10 plates, at most 0.37%.
- **Performance:** High 60 fps, p95 16.8 ms; Mid ≥ 30 fps; payload 4.1 MB; interactive in 1.25 s.
- **Anatomy:**
  - true-calibre nerve;
  - emphasis by contour and dimming only;
  - the self-review checklist is in the packet.
- **Orientation:** the view direction changes only with explained moves, and the glyph shows them.
- **Labels:** all checks pass.
- **Accessibility:** keyboard, announcements, reduced motion and the static tier (tested).
- **Validators:** they pass, and every sentence cites a claim.
- **Design:**
  - chrome under 10%;
  - the avoid-list audit passes (the only near item is the text panel's scrim, which sits in the space the camera leaves free);
  - violet only as ink;
  - the field ADR is decided.

**Not fully met:**
- **Tragal-pointer distance.** Plan §14 says every modelled landmark distance must fall inside its cited range. The tragal-pointer distance (19.7 mm) is outside both study ranges.
  - The published measurements themselves disagree.
  - The cartilage is not resolved on CT, so the landmark is an estimate.
  - The claim is marked uncertain and the value is reported, not asserted.
  - This is left for clinical review rather than tuned.
- **Claims not yet checked against sources.** All 23 claims are `to-verify`. The validators pass because verification status is reported, not enforced.
- **Hardware not tested:** Mid-class devices, Safari and real phones are unavailable here. Mid is approximated by CPU throttling.
- **Owner validation questions:** where the parotid is, why the nerve matters, and where the tumour is relative to the nerve. These are for the owner to answer from the slice.

## Corrections made in M1 (see the QC log)
- The M0 CT grid cropped the face (ADR-0002 amendment).
- TotalSegmentator's `head` class is not a solid body.
- Axial QC crops were drawn upside-down (an own error).
- **Deep lobe versus the posterior digastric.** The CT shows muscle 2–4 mm beyond the authored tube. That tissue is now excluded.
- **Stale face-fit value.** The committed `checks.json` value was stale: the 1.5 mm voxel capsule sat 1.9 mm under the skin. The capsule was rebuilt.
- **Camera pan.** It used a stale matrix (arrivals differed by 37–77%).
- **Convergence timing.** "Converged" fired during a dissolve.
- **TRAA history.** It was not reseeded.
- **Pipeline compilation at settle.** Pipelines were not compiled before the reseed (peel differed by 0.75%).
- **Static figures.** They were never linked in the build.
- **Label layout.**
  - Labels overlapped at Clinical depth, where they have two lines.
  - Portrait labels overflowed.
  - The flap focus sat 13 L\* above the field; muscle is now lighter.

## Open questions and known issues
- **Clinical review is deferred until the app is fully implemented** (owner decision). The review packet and QC log are current. Public launch is blocked until sign-off.

**Unresolved registration and QC limits** (`docs/qc/QC_LOG.md`):
- **Cryosection registration** is local, at three levels:
  - in-plane only;
  - one level rests on a single landmark;
  - no correction for out-of-plane tilt.
- **The facial nerve is not verified against the cryosections.** It is not resolvable at 0.33 mm/px, so it rests on CT landmarks, cited ranges and relationship rules.
- **Deep portion.**
  - The authored deep portion is 7.7 mL, and the gland totals 25.7 mL.
  - The cryosection overlay still suggests about 3 mm of overlap with the posterior digastric at z 231. That is within registration uncertainty; the CT check passes.
  - The stylomandibular-tunnel extension is not modelled.
- **Superficial share:** 59% against the published 61–69% (reported, not tuned).
- **Tragal-pointer distance:** outside both study ranges (reported only; see above).
- **Layers** are constant-depth bands, not segmented.
- **Flap.**
  - The flap is a curl, not a tissue simulation.
  - Skin just past the incision ends stretches over 12 mm.
  - There is no platysma mesh, so the operative plates hide the SMAS outside the capsule.

**Other:**
- **Determinism** first-run timeout: one early capture run timed out on a cold load while a stray preview server was running. It did not recur in later runs.
- **Environment:** npm 9.1.2 is on PATH (`C:\Python\npm`) with Node 24.16, and Astro prints a harmless engine warning.
- **Plan deviation:** Astro 7.3.5 was used instead of Astro 6 (ADR-0001).
- **`astro check`** has not been added yet.
- **Evidence items to verify before use:**
  - the primary source for the Milan 2nd-edition risk-of-malignancy figures (`rossi-2024`);
  - the Bernhard 2026 PMID;
  - a primary citation for the Stensen's duct course;
  - a source for the preauricular hollow;
  - a source for the clear facial drape.
- **Disk:** pip's cache holds an unused 2.7 GB CUDA wheel (`pipeline/segment/.venv/Scripts/python -m pip cache purge`).
