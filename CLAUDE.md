# Parotid Surgery Atlas

Private educational atlas of parotid tumours and parotidectomy, with pleomorphic adenoma as the representative case. A continuous, reversible 3D dissection should make the tumour's relationship to the facial nerve and surgical plane intelligible at both lay and clinical depth. The anatomy is the primary interface; medical accuracy and spatial clarity take precedence over decorative presentation.

## Project orientation

- Read `docs/STATUS.md` for the current milestone, next work and open questions. Follow the approved `docs/plan.md` for product scope and acceptance criteria; record consequential technical decisions in `docs/adr/`.
- `apps/site` contains the Astro site, narrative and accessible content. `packages/schema` defines shared content contracts; `packages/timeline` evaluates the narrative state; `packages/stage` renders it. `pipeline` generates anatomical assets from source data and authored specifications. `tools/validate` checks content, evidence and provenance.
- npm workspaces consume package TypeScript source directly; there is no separate package build step.

## Commands

- `npm run dev` — start the site.
- `npm run build` — build the static site.
- `npm test` — run Vitest; for one file use `npx vitest run path/to/file.test.ts`.
- `npm run typecheck` — check workspaces; use `npm run typecheck -w @atlas/timeline` for that workspace alone.
- `npm run validate` — check content, evidence and asset provenance.
- `npm run check` — typecheck, test, validate and build. Run it before checkpoint commits.

## Project invariants

- `@atlas/schema` owns the content contracts. Keep site content and validators consistent with those schemas.
- `@atlas/timeline` derives scene state solely from the requested timeline position; backward scrubbing, deep links and cold loads must resolve to the same state. Keep renderer concerns in `@atlas/stage`. Treat renderer choices as provisional until the M0 feasibility evidence and ADR resolve them.
- Generate anatomical geometry reproducibly from documented sources and editable specifications. Validate clinically important topology and relationships visually against source anatomy as well as with automated measurements.
- Ground substantive medical and anatomical claims in traceable evidence. Preserve source status, uncertainty, disagreement and the population behind numerical claims. Distinguish a representative operation from universal practice; do not invent anatomy, clinical claims or patient imaging.
- Record each external asset's source, actual license or legal basis and obligations, attribution, checksum and transformations. Do not infer that all usable sources share the same license terms.
- Preserve a meaningful semantic/static experience and reduced-motion path. Passive scrolling must not move keyboard focus; announce settled authored plates rather than every scrub frame.

## Milestone gates

- Follow the current phase and next step in `docs/STATUS.md`; use `docs/plan.md` for milestone acceptance criteria.
- In M0, validate anatomical registration and the representative WebGPU/WebGL2 rendering requirements in `docs/plan.md` §0 before scene work depends on them (done: ADR-0001, ADR-0002).
- Record unresolved registration and QC limits in `docs/qc/QC_LOG.md` and `docs/STATUS.md`.
