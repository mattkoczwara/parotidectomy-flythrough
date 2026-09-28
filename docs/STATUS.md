# Project status

_Last updated: 2026-09-28_

## Current phase
**M0: foundations and de-risking.**
- Done: schemas, validators, verified sources, and the renderer spike (stack locked).
- Remaining: the registration spike, which needs download approval.

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

## Next step: M0 registration spike (**needs download approval**)
- HRA vs TotalSegmentator mandible: mean surface distance under 2 mm.
- Parotid overlaid on three cryosection levels.
- Visual QC contact sheets for the segmentations.

Required downloads: the Visible Human male head CT and cryosection subsets, the HRA reference-organ GLB, and the TotalSegmentator weights plus the PyTorch runtime.

## After M0: M1 vertical slice (plan §12)
- Timeline engine, director and plate DOM.
- Pipeline authoring of the facial nerve, retromandibular vein (RMV), external carotid artery (ECA) and great auricular nerve (GAN) from specs, with topology assertions.
- Face fit, look development, labels, evidence drawer, accessibility, static fallbacks.

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
