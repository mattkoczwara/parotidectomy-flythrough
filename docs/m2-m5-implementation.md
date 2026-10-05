# M2–M5 implementation plan (working document)

Owner authorisation (2026-10-04): proceed past M1 despite its documented exceptions, to an implementation-complete private-use application. This does **not** resolve M1's exceptions, answer the owner's comprehension questions or constitute clinical sign-off. Clinical review remains after implementation; public launch stays blocked on it.

This file is the working script for the remaining chapters. `docs/plan.md` stays the approved product plan; `docs/STATUS.md` is the current state. Progress is tracked in the checklist at the end; work not yet through the final verification pass is labelled **unverified** there.

## Design decisions made for the remaining work

1. **Pieces and groups.** The superficial and deep lobes are rebuilt as closed *pieces* (ESGS levels I–V, plus the extracapsular cuff around the tumour) cut from the same completed-gland voxel mask, so their union is the lobes. `parotid_superficial_lobe` and `parotid_deep_lobe` stay as *group* structures (`members` in the structure record) so existing plate deltas keep working; `@atlas/timeline` expands group deltas onto members at compile time (a member's own patch wins).
2. **Variants are continuous.** A discrete variant (resection, incision, nerve pattern, barrier) cross-fades as weights (`SceneState.variantMix`), so scrubbing from one variant plate to the next moves pieces continuously instead of popping at a window midpoint. Plateau states are one-hot.
3. **Removal is two scalars.** `op.peel` (dissection: the existing baked-field fold) and `op.out` (the specimen leaves the field: a rigid move). A resection variant only chooses *which pieces* respond. The deep lobe (total parotidectomy) uses `out` with a nerve-mobilisation field, and is labelled schematic.
4. **Schematic is a visual grammar.** Naturalistic shading = modelled anatomy. Hatch/line = schematic (pseudopodia, imaging outlines, risk territories, Frey regrowth, needle and probe). Complication territories use the single desaturated ochre and appear only in the Complications chapter and the evidence drawer.
5. **Ink.** Gentian-violet ink marks the incision plan (both variants), ESGS level boundaries and resection margins. Level boundaries and the cuff outline are baked per vertex (`_INK`), not drawn as extra geometry.
6. **Insets live in the document.** An inset is a `<figure>` inside its plate article (in reading order, with a text equivalent). In landscape with the scene running, CSS lifts it into the stage's right column while its plate is current; in portrait, static and no-script it stays in the text lane.
7. **Imaging.** The registered CT slice is a textured plane at the true axial level, with everything above it clipped; the tumour appears only as a hatched outline. Real cryosection photographs are optional extras, not required.
8. **Explorer.** The instrument (depth dial per tissue family, orbit/zoom buttons, structure query) is available on every plate; the Explore chapter opens it with the operation controls (resection variant, barrier, incision, progress). Comparison of procedure extents is a grid of renders of the real model per variant, with piece volumes computed in the pipeline.

## Plate script

Existing M1 plates keep their ids. Chapters in order; `●` exists from M1.

| # | id | Chapter | Purpose |
|---|----|---------|---------|
| 1 | face ● | Orientation | face, lump, glyph |
| 2 | where-parotid ● | Orientation | the gland among its neighbours |
| 3 | duct | Orientation | what the gland does; Stensen's duct; accessory lobe |
| 4 | layers ● | Layers | skin → fat → SMAS → capsule |
| 5 | nerve-within ● | Facial nerve | the nerve in the gland |
| 6 | trunk-pes | Facial nerve | foramen, trunk, first division |
| 7 | branch-groups | Facial nerve | five groups and what each moves |
| 8 | nerve-plane ● | Facial nerve | outer and inner gland; the tumour is lateral |
| 9 | nerve-variants | Facial nerve | interconnections and trunk variation (Davis/Katz; pooled prevalence) |
| 10 | tumour ● | Tumour | the pleomorphic adenoma |
| 11 | tumour-positions | Tumour | superficial, deep, tail, accessory |
| 12 | pseudocapsule | Tumour | inset: pseudocapsule, pseudopodia, satellites (schematic) |
| 13 | no-shelling | Tumour | why enucleation fails; the cuff |
| 14 | ultrasound | Finding out | probe and plane |
| 15 | cross-section | Finding out | registered CT slice; hatched outline; MRI |
| 16 | needle | Finding out | FNA and core biopsy |
| 17 | milan | Finding out | Milan categories (table inset) |
| 18 | esgs-levels | Choosing | five levels in ink |
| 19 | option-ecd | Choosing | extracapsular dissection |
| 20 | option-partial | Choosing | partial superficial |
| 21 | option-superficial | Choosing | superficial |
| 22 | option-total | Choosing | total, nerve preserved |
| 23 | choosing | Choosing | what moves the choice (size, mobility, depth) |
| 24 | evidence-limits | Choosing | what the studies can and cannot tell |
| 25 | incision ● | Operation | modified Blair, in ink |
| 26 | incision-facelift | Operation | the facelift variant |
| 27 | flap ● | Operation | the skin flap |
| 28 | gan | Operation | the great auricular nerve |
| 29 | landmarks ● | Operation | tragal pointer, tympanomastoid suture, digastric |
| 30 | trunk | Operation | trunk found; the nerve monitor |
| 31 | pes-divisions | Operation | following the trunk to the first split (peel ≈ 0.2) |
| 32 | upper-division | Operation | upper branches (peel ≈ 0.4) |
| 33 | peel ● | Operation | lower branches (peel 0.6) |
| 34 | lobe-lifts | Operation | the lobe comes off the nerve (peel 1.0) |
| 35 | specimen-out | Operation | the specimen leaves the field |
| 36 | bed | Closure | the nerve in its bed; haemostasis |
| 37 | barrier-smas | Closure | SMAS flap |
| 38 | barrier-scm | Closure | SCM flap |
| 39 | barrier-graft | Closure | other barrier |
| 40 | drain | Closure | drain |
| 41 | closed | Closure | skin closed |
| 42 | after-anatomy | Afterwards | what is gone and what remains |
| 43 | contour | Afterwards | contour change |
| 44 | pathology | Afterwards | the specimen and the report |
| 45 | healing | Afterwards | timeline (institutional practice flagged) |
| 46 | compl-map | Complications | each complication has a structure |
| 47 | weakness | Complications | marginal mandibular and temporal branches |
| 48 | numbness | Complications | great auricular nerve |
| 49 | frey | Complications | auriculotemporal nerve; sweat glands |
| 50 | first-bite | Complications | first-bite syndrome |
| 51 | sialocele | Complications | sialocele and fistula |
| 52 | recurrence | Complications | recurrence |
| 53 | explore | Explore | the instrument |
| 54 | compare | Explore | procedure extents side by side |

Chapters (rail): Orientation, Layers, Facial nerve, Tumour, Finding out, Choosing, Operation, Closure, Afterwards, Complications, Explore. Plan §3 chapter 7 (the operation) carries the representative superficial parotidectomy; chapter 6 shows the four resections' extents on the same gland.

## Geometry and renderer work by chapter

- **Pieces (ch. 3, 6, 7, 8):** ESGS levels from the nerve-plane height field and a cranial/caudal surface through the buccal branch; level V is an authored accessory lobule on Stensen's duct; the ECD cuff is lateral gland within a margin of the tumour; per-vertex `_PEEL`, `_INK` (vec3: nerve-plane trace, cranial/caudal trace, cuff outline) and `_CUTFACE`. Piece volumes go to the QC record.
- **Nerve (ch. 3, 6):** variant patterns as extra twig meshes toggled by variant weight; nerve mobilisation field `_MOB` for the total parotidectomy.
- **Tumour (ch. 4):** three alternate placements (deep lobe, tail, accessory) with placement checks.
- **Imaging (ch. 5):** a CT slice texture (real, registered, normal anatomy), the tumour's hatched section outline, a probe prop and a ultrasound sector plane, a needle path.
- **Operation (ch. 7):** facelift incision as a second set of `_CUT/_CUTS/_FLAPW` fields; stimulator probe prop.
- **Closure/after (ch. 8–9):** SMAS flap, SCM flap and graft barrier meshes; drain tube; suture ticks and scar from `_CUTS`; a baked contour-change field on skin, fat and SMAS.
- **Complications (ch. 10):** `_ZONES` (vec4) risk territories on the skin (earlobe, lower lip, Frey region); auriculotemporal nerve; sialocele pocket; Frey regrowth fibres in hatch.
- **Stage:** parts and groups, hatch mode, per-part removal uniforms and specimen transform, section-plane clip with cut caps, imaging plane, zones, instrument overrides, picking.

## Evidence rules for this work

Every plate sentence resolves to a claim; every number has its population; no retracted source. A claim is set to `verification: checked` only after its wording and numbers were compared with the source text (abstract or full text) retrieved during this work; source checking is not clinical review, and every claim stays `clinicalReview: pending`. The public-build gate refuses `to-verify` and unreviewed claims.

## Progress checklist

_(**unverified** = built and looked at in focused render loops, but not yet through the final verification pass; see `docs/STATUS.md` for the measured state.)_

- [x] Plan and decisions recorded (this file, ADR-0004)
- [x] Pieces, groups and continuous variants in the timeline and stage; shared `RESECTION_EXTENT`
- [x] Geometry: ESGS pieces and cuff, duct and accessory lobe, alternate tumours, nerve-pattern twigs, auriculotemporal nerve and Frey regrowth, instruments, CT slice, SMAS flap, neck-muscle strip, graft, drain, saliva collection, recurrence nodules
- [x] Stage: peel/out/deep, SMAS fold, neck-muscle turn, CT plane with global clip, overlay planes, risk territories, ochre schematics, picking, selection contour
- [x] Plates 1-54 in 11 chapters; insets (pseudocapsule, Milan and other framed figures, choice table, healing timeline, comparison)
- [x] Instrument on every plate; Explore operation controls; structure cards; comparison renders and volume table
- [x] Evidence: 68 claims all compared with fetched source text; glossary of 41 terms drawn from the claims; credits generated from asset and source records
- [x] Validators: paragraph attribution, glTF node and checksum checks, glossary drift, public gate
- [x] Reference pages (method, credits and sources, glossary); print stylesheet
- [x] Capture suite extended (instrument, pages, print, accessibility); sequential determinism passes
- [x] Final verification on the assembled application (see STATUS.md for results): `npm run check`, `capture`, `perf`, review packet; Firefox ran but found a shader defect that is open (STATUS.md, Next)
