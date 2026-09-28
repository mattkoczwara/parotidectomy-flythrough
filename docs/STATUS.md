# Project status

_Last updated: 2026-09-28_

## Current phase
**M0 complete (2026-09-28). M1 (vertical slice) in progress.**
- Done in M1 so far: the timeline engine (`@atlas/timeline`) and the step/chapter schemas.

## Completed
- [x] Planning: `docs/plan.md` (approved 2026-09-28). The owner's refinements are folded in:
  - anatomy QC covers topology and relationships and uses visual overlays, not only distances;
  - passive scrolling never moves focus;
  - only settled plates are announced;
  - the semantic DOM is the primary assistive-technology path.
- [x] Bootstrap gate.
- [x] M0 content contracts (`@atlas/schema`, zod 4). They are shared by Astro content collections and `tools/validate`:
  - sources, claims (with framed numbers), structures, assets (provenance) and glossary.
- [x] M0 validators. These fail the build on:
  - retracted PMIDs;
  - claims that cite retracted sources;
  - numbers not tied to a cited source, or outside their CI;
  - disallowed licences without an ADR;
  - missing provenance;
  - broken cross-references.

  Unit-tested.
- [x] M0 sources: 52 records in `apps/site/src/content/sources/`.
  - 48 citations verified against PubMed E-utilities (title, journal, volume, pages, DOI, publication type).
  - Barrameda 2026 is confirmed retracted by its notice (PMID 42520282) and recorded as retracted.
- [x] **M0 renderer spike: passed, stack locked.** Results table in `docs/adr/0001-web-stack.md`; harness in `spikes/renderer`.
  - Two technique changes, with the plan updated:
    - single-layer blended ghosting replaces alpha-hash plus TRAA, which left residual stipple;
    - the peel hinge sits on the lateral surface, because a deep-face hinge self-intersects.

- [x] **M0 registration spike: done, criterion failed and resolved by design** (ADR-0002). Downloads approved 2026-09-28.
  - **Canonical frame:** the Visible Human male normal CT.
    - Resampled from five series.
    - Laterality verified against anatomy: the aortic arch is on the patient's left.
  - **TotalSegmentator (GPU):** the parotid, masseter, mandible, SCM, IJV and submandibular gland are plausible on source-CT overlays; the parotid is 18.2 mL. The digastric, styloid, zygomatic arch and ICA segment as fragments or not at all, so they will be authored.
  - **HRA vs CT:** mandible 5.7 mm and parotid 12–13 mm, which fails the < 2 mm criterion. The HRA is kept as a morphology reference only.
  - **Cryosections vs CT:** the posture differs non-rigidly and automatic registration failed three ways, so cryosections get landmark registration in M1.
  - QC images are in `docs/qc/m0-registration/`, with log entries in `docs/qc/QC_LOG.md`.

## Next step: M1 vertical slice (plan §12)
1. **Plate DOM and accessibility skeleton** in `apps/site`: steps as MDX, the semantic path first, the director with passive scroll that never moves focus, and a settled-plate live region.
2. **`@atlas/stage`:** port the spike's materials, ghosting, clipping and peel, then add framing-based cameras and `resolve(SceneState)`.
3. **Anatomy pipeline:** TotalSegmentator meshes into glTF; specs and authoring for the facial nerve, RMV, ECA, GAN, digastric and styloid; topology assertions; the lobe split and baked fields.
4. **Landmark registration of cryosections** around the parotid, for tracing and QC. **Needs download approval** for about 150 photographs (about 500 MB).
5. Face fit (MPFB; **needs a download**), look development, labels, evidence drawer, static fallbacks.

## Open questions and known issues
- **Clinical review is deferred until the app is fully implemented** (owner decision). Review packets and the QC log must stay current from M1 onward. Public launch is blocked until sign-off.
- **npm 9.1.2 is on PATH** (`C:\Python\npm`) with Node 24.16. Astro 7 prints an engine warning (it wants npm ≥9.6.5); nothing is affected so far.
- **Plan deviation:** Astro 7.3.5 was used instead of Astro 6 (ADR-0001).
- **`astro check` not added yet.** `typecheck` runs tsc on `.ts` only.
- **Evidence items to verify before use:**
  - the primary source for the Milan 2nd-edition risk-of-malignancy figures (`rossi-2024`, citation-only);
  - the Bernhard 2026 PMID;
  - a primary citation for the Stensen's duct course;
  - a source for the preauricular hollow;
  - a source for the clear facial drape.
- **Spike limits:** performance was proved on 97k proxy triangles only; re-measure on the real slice. Real mobile and Safari hardware are untested.
- **Possible truncation:** the `CLAUDE.md` "Milestone gates" section ends mid-sentence ("…rendering requirements in `docs/plan"). It looks truncated; the owner should check it.
