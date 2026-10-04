# ADR-0004: Pieces, continuous variants and the schematic grammar

_Status: accepted 2026-10-04 (M2–M5 implementation). Supersedes nothing; extends ADR-0001 (the peel) and ADR-0003 (ink colour)._

## Context

The M1 slice showed one operation on one gland: a single peel field folded the whole superficial lobe off the nerve. The approved plan (§3, §6, §8) needs the same gland to be shown four ways (extracapsular dissection, partial superficial, superficial and total parotidectomy), with variants of the incision, the nerve's branching pattern and the closure layer drawn on the same model, and a visible difference between modelled anatomy and a simplification. Scrubbing between two variants has to be continuous and deterministic (a pure function of the timeline position), and the semantic and static path has to remain complete.

## Decisions

1. **The gland is cut into closed pieces** (`pipeline/anatomy/pieces.py`): the ESGS levels I–IV, the extracapsular cuff around the tumour and an accessory lobule, all from one completed-gland mask, so their union is the former superficial and deep lobes. The lobes remain *group* structures (`members` in the structure record); `@atlas/timeline` expands a group's patch onto its members when the track is compiled, and a member's own patch wins. Each piece carries baked per-vertex fields: dissection order (`_PEEL`), cut-face weight, ink signed distances (`_INK`) and, for the nerve, a mobilisation weight (`_MOB`).
2. **A resection variant chooses which pieces respond; it does not change the pieces.** Which pieces each operation takes is one table (`RESECTION_EXTENT` in `@atlas/timeline`) shared by the renderer and the site's comparison table. Removal is expressed by three scalars on the scene state: `peel` (the dissection fold), `out` (the specimen leaves the field as a rigid move) and `deep` (the inner pieces of a total parotidectomy, with the nerve first mobilised by `mobilise`).
3. **Variants are continuous weights, not switches.** Every enum choice (resection, incision, nerve pattern) is carried as `variantMix`, one-hot at a plateau and cross-faded in a transition, so the pieces of two operations move into each other during a scrub. Meshes that exist only under some variants (the interconnecting twigs of the nerve patterns) fade by the weights.
4. **Ink is vertex data.** Level boundaries, the nerve-plane trace and the cuff outline are drawn from per-vertex signed distances, so they are sub-triangle exact, cost no geometry, and are withheld on surfaces parallel to the dividing surface.
5. **Schematic is a visual grammar.** Naturalistic shading means modelled or authored-to-specification anatomy; line and hatch mean a simplification (pseudocapsule inset, imaging outlines, instruments' planes, Frey regrowth, the saliva collection, recurrent nodules). The complication schematics and the skin territories use the one desaturated ochre and appear only in the Complications chapter. Instruments are cool grey and never a tissue colour. Violet stays ink.
6. **Imaging is the donor's normal CT, never a tumour.** The registered axial slice at the tumour level is a textured plane with a global clip (`ct_clip`) that cuts the head at its level; the tumour is a dashed, hatched outline on it. Real anatomy appears only as the donor's own; no synthetic patient images are made.
7. **The instrument is an override layer.** The depth dial (per tissue family), orbit and zoom buttons, a click for a structure card and, in the Explore chapter, operation controls all act on the evaluated state or the camera and never on the timeline. A plate change returns the dial and the operation; scrolling returns the camera.
8. **Approximations are named in the content.** The barrier flaps are a hinged sheet and a rigid turn of a strip; the facelift incision is a planned line (the flap is cut along the Blair path); the contour change is a Gaussian displacement of illustrative depth; delivering the inner lobe from beneath the nerve is schematic. Each is stated in a `<Model>` sentence in its plate and in the Method page's limits.
9. **The page is a document first.** Paragraph attribution is enforced by the validator (a claim or a `<Model>` statement for every paragraph), and the print stylesheet turns the atlas into text, still figures and opened notes.

## Alternatives rejected

- *Morph targets per resection:* four sets of deformations per piece multiply the asset and cannot be cross-faded with continuous timeline variants.
- *Boolean cuts at run time:* costly, not exactly reversible, and the cut faces are better baked.
- *Separate meshes per operation:* duplicates the gland and breaks the single registered body.
- *Discrete variant switches:* a scrub between two operations would pop at the midpoint.

## Consequences

- Plate deltas can name a group (`parotid_superficial_lobe`) and still move individual pieces.
- A change to which pieces an operation takes is one edit in `resections.ts`; the renderer, the comparison table and the Explore controls follow.
- Every approximation is a known limitation to report (STATUS.md, `/method/`), not a hidden simplification.
