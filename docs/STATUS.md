# Project status

_Last updated: 2026-09-28_

## Current phase
**Bootstrap gate: complete.** Waiting for the user to resume before M0 starts.

## Completed gates
- [x] Planning: `docs/plan.md` (approved 2026-09-28).
- [x] Bootstrap gate:
  - git `safe.directory` set; branch `main`;
  - npm workspaces scaffolded; Astro minimal starter in `apps/site`;
  - packages `schema`, `timeline` and `stage`;
  - `tools/validate`; pipeline directories;
  - `dev`, `build`, `test`, `typecheck`, `validate` and `check` commands all pass; the dev server was checked in the browser.

## Next step: M0 (foundations and de-risking)
Run these in parallel, before any scene code:
1. **Renderer feasibility spike.** Plan §0 has the full pass criteria. It uses a proxy gland and nerve and must work on both WebGPU and forced WebGL2:
   - ghosting;
   - a cut surface with its cap;
   - the baked-field peel;
   - a TSL tissue material;
   - the focus contour;
   - GTAO and TRAA;
   - deterministic capture;
   - frame-time budget.

   The result locks or replaces the stack in ADR-0001.
2. **Registration spike:**
   - the HRA and TotalSegmentator mandibles must agree to under 2 mm mean surface distance;
   - the parotid is overlaid on three cryosection levels.
   - **Needs user approval for downloads:** Visible Human CT and cryosection subsets, the HRA "mouth" GLB, and the TotalSegmentator weights.
3. Real zod schemas: step, claim, source, structure, asset, glossary.
4. Real validators: claims, retraction blocklist, populations on numbers, provenance.
5. Enter the corrected bibliography as source records.

## Open questions and known issues
- **Clinical review is deferred until the app is fully implemented** (owner decision). Review packets must stay current from M1 onward. Public launch is blocked until sign-off.
- **npm 9.1.2** is on PATH (`C:\Python\npm`) next to Node 24.16. Astro 7 prints an engine warning (it wants npm ≥9.6.5); nothing else is affected so far. Upgrading npm is the owner's call.
- **Plan deviation:** the plan names Astro 6, but Astro 7.3.5 is the current stable release and was scaffolded instead. See ADR-0001.
- `astro check` (`@astrojs/check`) was not added at bootstrap. `typecheck` runs tsc on `.ts` only; add `astro check` when `.astro` components gain logic.
- **Evidence items to verify before use:**
  - the primary source for the Milan 2nd-edition risk-of-malignancy figures;
  - the Bernhard 2026 PMID;
  - a primary citation for the Stensen's duct course;
  - a source for the preauricular hollow;
  - a source for the clear facial drape used to watch for facial movement.
