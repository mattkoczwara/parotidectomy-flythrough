# Parotid Atlas: agent conventions

Read `docs/STATUS.md` first (current phase, next step, open questions), then `docs/plan.md` (the approved plan) as needed. Record consequential decisions as ADRs in `docs/adr/`.

## Execution gates
- Work proceeds milestone by milestone (`docs/plan.md` §11). At the end of each gate or milestone, update `docs/STATUS.md`, make a checkpoint commit and stop for the user.
- The rendering stack is **provisional** until the M0 renderer spike passes (`docs/adr/0001-stack-provisional.md`). Do not add scene code that depends on three.js beyond the spike until it is locked.
- Clinical review happens after full implementation. **Nothing is published publicly** until claims and anatomy specs carry clinical sign-off.

## Medical content rules
- Every substantive sentence resolves to a claim (`<Claim id>`). Every number carries its population, n, design and CI or range.
- Evidence classes: Established anatomy / Standard surgical principle / Representative technique / Varies by surgeon or institution / Comparative evidence / Uncertain or evolving.
- Never cite retracted sources. Barrameda 2026 (PMID 41353726) is retracted. Recheck retraction status whenever a source is added.
- Show disagreement between sources; do not resolve it by intuition. Label institutional practice (e.g. Iowa protocol) as representative.
- No fabricated patient imaging. Schematic content is rendered in illustrative (line/hatch) style; naturalistic shading means modelled anatomy.
- The facial nerve is shown at true calibre. Emphasis comes from context dimming and a contour, never from inflation or glow.

## Assets and provenance
- Every shipped asset needs a provenance record: source, licence, attribution, sha256, list of transformations. The validator fails without one.
- Allowed by default: CC0, CC BY, Apache-2.0, Visible Human (with NLM attribution). Excluded by default: share-alike (Z-Anatomy), NC, ND, and commercial marketplace licences.
- Raw third-party data lives in `pipeline/sources/raw/` (gitignored). Commit only manifests.
- Ask the user before any large download.
- No real person's face: the head surface comes from an MPFB/MakeHuman base head fitted to the Visible Human landmarks.

## Pinned toolchain
- Node 24. The `npm` on PATH is 9.1.2 (`C:\Python\npm`), which triggers an astro engine warning; it is harmless for now.
- TypeScript 6.x. Stay on 6 until Astro tooling supports TS 7.
- Astro 7.x, Vitest 5.x, zod 4.x.
- three.js r186 is pinned once it is locked; upgrades are deliberate and done in their own commits.
- Blender 5.2 for pipeline scripts.
- TotalSegmentator runs in a uv venv on Python 3.11/3.12.

## Commands
- `npm run dev`: Astro dev server at http://localhost:4321. In the desktop app, use `.claude/launch.json` "site".
- `npm run build`: build the static site.
- `npm test`: Vitest across workspaces.
- `npm run typecheck`: tsc in every workspace.
- `npm run validate`: content, evidence and provenance validators.
- `npm run check`: all of the above. It must pass before every commit.

## Code conventions
- `packages/timeline` stays pure and renderer-free. Scene state is `evaluate(track, t)`, with no accumulated per-frame state.
- `packages/stage` is the only place that knows about the renderer.
- Content and specs are data: an anatomy correction is a spec edit plus a rebuild, never a hand edit to a mesh.
- Match the surrounding code; keep comments sparse and purposeful.
