# Project status

_Last updated: 2026-09-28_

## Current phase
**M1 (vertical slice) in progress.** The scene, site and director are running end to end in WebGPU with the real anatomy. The remaining M1 work is listed under "Next".

### M1 done so far
- **Timeline engine** (`@atlas/timeline`) plus step and chapter schemas (a type test keeps them assignable).
- **Anatomy pipeline** (`bash pipeline/build/build.sh`, or `npm run anatomy`), all in the canonical CT frame (ADR-0002):
  - **Landmarks:** automatic, plus visual picks recorded with evidence.
  - **Authored anatomy from cited specs:** facial nerve, great auricular nerve, veins and arteries, digastric, styloid. It passes 12 topology and relationship checks.
  - **Segmented surfaces.**
  - **Authored retromandibular deep portion:** the CT does not resolve it.
  - **Nerve-plane lobe split.**
  - **Tumour:** about 19 mm, in the superficial lobe, with 1.6 mm nerve clearance.
  - **Generic MPFB (CC0) face:** fitted over the dissection field; the donor's face is not reproduced.
  - **Fat and SMAS shells:** built under the final skin.
  - **Output:** glTF export plus meshopt, 2.56 MB, about 400k triangles.
  - **Checks:** results in `docs/qc/m1-anatomy/checks.json`; every check passes.
- **Stage** (`@atlas/stage`): three.js r186 `WebGPURenderer`. It provides:
  - tissue-family TSL materials;
  - terraced cutaway windows;
  - the single-layer ghost;
  - the peel in the glTF frame;
  - a non-emissive focus contour;
  - GTAO with TRAA (FXAA on Mid);
  - framing-based cameras with a text-column offset;
  - light presets;
  - anchor projection with occlusion.

  Quantised attributes are converted to float at load, because WebGPU has no 16-bit vec3 or scalar vertex formats.
- **Site** (`apps/site`):
  - 8 plates across 5 chapters as MDX, with inline `<Claim>`;
  - self-hosted Newsreader and Atkinson Hyperlegible Next;
  - the director: native scroll → t, plateaus, a damped follow, the long-jump dissolve, a reduced-motion mode with plateau-only dissolves, settled-plate announcements, focus only on explicit navigation (J/K, ←/→, rail, previous/next), and deep links re-seated after layout;
  - margin labels with leaders, the plane gauge, reading depth (Essentials, Anatomy, Clinical), the evidence drawer, instrument-mode orbit, the static tier, and a capture mode.
- **Content:** 23 claims (all `to-verify`), 42 structures, 8 asset provenance records including the scene GLB (checksum) and the fonts.
- **Authorised downloads, done 2026-09-28** (terms verified; manifests with checksums; raw data gitignored):
  - 151 Visible Human cryosections (a_vm1090–1240, 463 MB);
  - the MPFB 2.0.17 archive (43 MB; only the CC0 assets are used; the add-on is not installed).
- **Tools:** `tools/capture`, a Playwright suite for static figures, determinism and focus/announcement assertions (`npm run capture`). **All 4 tests pass** (real Chrome, WebGPU, 1600×1000):
  - static figures are captured for all 8 plates, and labels are present;
  - cold load vs forward and backward scroll arrival: at most **0.47%** of pixels differ (limit 0.5%). The residual is 1-pixel anti-aliasing edges; the margin is thin on tumour and nerve-within;
  - passive wheel scrolling across plates does not move focus or announce transitions;
  - J/K focuses the destination heading once it has settled.
- **Validator:** step frontmatter is checked against the schema, along with references (chapter, structures, labels, frames, claims and inline `<Claim>` ids). It reports `to-verify` and pending-review counts.

- **Cryosection registration and tracing QC** (`pipeline/anatomy/cryo.py`, `docs/qc/m1-cryo/`):
  - photographs are anterior down with the patient's right on the image left, established from mastoid pneumatisation asymmetry;
  - three levels registered locally with the documented 0.33 mm/px, a shared rotation and point landmarks: rms 0.9–2.7 mm, leave-one-out up to 7.6 mm;
  - the authored RMV and ECA agree with photographed vessels to about 1–5 mm, and their relationships match. No geometry was changed;
  - the facial nerve is not resolvable in the photographs, so it remains unverified against them.

### Determinism fixes (2026-09-28)
- **Camera pan used a stale camera basis.** `placeCamera` read `matrixWorld` after `lookAt()`, which does not update it, so the frame then depended on the previous pose. This made the difference between arrivals 37–77%. It now uses the quaternion. All static figures were recaptured with the corrected framing.
- **"Converged" fired during the dissolve fade-in.** The 160 ms blank was counted as stillness. The settle timer now restarts when a dissolve lands, and convergence waits for the fade.
- **`settle()` now reseeds TRAA history after aligning the jitter phase.** Transparent ghosts are not in the depth prepass, so history from the previous plate could otherwise survive.

### Corrections made in M1 (see the QC log)
- **M0 CT grid cropped the face.** It was built from the intersection of fields of view. It is rebuilt on their union, and segmentation was rerun. With the complete mandible, **HRA mandible registration passes at 1.8 mm**; the HRA parotid is still 12–15 mm off, so the decision stands (ADR-0002 amendment).
- **Depth below the skin was wrong.** TotalSegmentator's `head` class has internal boundaries. It is replaced by a solid CT body mask.
- **Axial QC crops were drawn upside-down** (an own error). They are fixed, and the readings were redone.

## Next (M1)
1. **Composition review** of each plate on the recaptured figures. With the corrected text-column pan, the right margin label column now overlaps tissue on some plates (e.g. layers). Fix during look development.
2. **More cryosection levels** (optional): extend the three registered levels toward the stylomastoid foramen and the lower pole if a nerve candidate can be confirmed; revisit the deep-portion medial bound against the posterior digastric at z 231.
3. **Operative plates not yet built:** incision planned (marker-ink line) and flap raised (plan §12 plates 7–8). The current plates 7 and 8 (landmarks, peel) show the exposure as a cutaway and say so in the text.
4. **Look development:** skin and gland material and colour, plus a field-colour A/B test and ADR (plan §5).
5. **Performance** on the real slice (High/Mid; throttled) and **Firefox**; a portrait/mobile pass.

## Open questions and known issues
- **Clinical review is deferred until the app is fully implemented** (owner decision). Review packets and the QC log stay current. Public launch is blocked until sign-off.
- **Unresolved registration limits:**
  - Cryosections are registered only locally at three levels (in-plane 2D; one level rests on a single landmark; out-of-plane tilt from the posture change is not corrected).
  - The authored RMV and ECA agree with the photographs within that uncertainty (1–5 mm). **The facial nerve cannot be verified against the cryosections** (not resolvable at 0.33 mm/px); it rests on CT landmarks, cited ranges and relationship rules.
  - The authored deep portion reaches a few millimetres into a muscle belly read as the posterior digastric at z 231 mm.
  - The superficial share is 58% vs the published 61–69% (reported, not tuned).
  - The gland is 26.4 mL, including the authored deep portion.
  - The stylomandibular-tunnel extension is not modelled.
  - The tragal-pointer distance falls outside both study ranges (reported only).
- **npm 9.1.2 is on PATH** (`C:\Python\npm`) with Node 24.16; Astro prints a harmless engine warning.
- **Plan deviation:** Astro 7.3.5 was used instead of Astro 6 (ADR-0001).
- **`astro check` not added yet.**
- **Evidence items to verify before use:**
  - the primary source for the Milan 2nd-edition risk-of-malignancy figures (`rossi-2024`);
  - the Bernhard 2026 PMID;
  - a primary citation for the Stensen's duct course;
  - a source for the preauricular hollow;
  - a source for the clear facial drape.
- **Disk:** pip's cache holds an unused 2.7 GB CUDA wheel (`pipeline/segment/.venv/Scripts/python -m pip cache purge`).
