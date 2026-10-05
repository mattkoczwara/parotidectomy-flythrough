# Final pass — clinical-review manifest

_Acceptance audit, 2026-10-05. Scope: every change made in the final presentation pass (`git diff pre-final-pass..HEAD`)
that altered anatomical or operative geometry, not appearance alone. Checks refer to `docs/qc/m1-anatomy/checks.json`
(27 checks, all passing, gate the export). Nothing here is clinically reviewed; every item stays `clinicalReview:
pending` until a clinician signs it off._

Pure presentation (materials, light, field, UI, hair, regional tint, poster, camera framings) is out of scope and
listed in ADR-0005. The donor-fitted surgical region, the authored nerves, vessels, gland, levels and the
representative tumour did not move.

## 1. Generic face base changed (adult male macro modifiers)

- **What:** the MakeHuman base mesh that supplies the generic face, auricle and scalp now carries MakeHuman's own
  macro modifiers (male, about 40 years). The fit to the donor CT is unchanged in method (`face.py`).
- **Why:** the raw base mesh is an androgynous neutral, and the donor is male.
- **Could affect:** skin depth over every structure; the auricle's shape and position (the flap and incision exclude
  it); which structures the skin covers behind the ear.
- **Measured:** fit scales 1.125/1.086/0.975 → 1.038/1.021/0.960. Conform-region residual is unchanged (median
  0.66 mm, p95 2.05 → 2.10). Shallowest soft tissue 2.17 → 2.48 mm, bone 1.76 → 2.26 mm. Larger depth changes:
  superficial temporal artery 10.6 → 6.9 mm, temporalis 4.2 → 3.0, great auricular (posterior) 4.5 → 2.9, external
  jugular 4.1 → 2.9, facial trunk 21.1 → 19.5, representative adenoma 3.0 → 3.7. Six conformed vertices now lie more
  than 6 mm from the donor's skin surface (previously none), centred at RAS (70.9, 39.6, 166.8): the upper neck behind
  the ear, where the skin is pushed out to cover authored superficial structures (item 2).
- **Checks:** `face_fit` (median residual ≤ 1.5 mm; soft tissue ≥ 2 mm and bone ≥ 1 mm below the skin; depth of
  every structure recorded), `incision_flap`, `exterior` (hair clear of the parotid region and the ear).
- **Human review:** skin thickness over the parotid and the superficial structures behind the ear; the six-vertex
  high-residual patch in the posterior upper neck; the generic auricle (by design not the donor's).

## 2. Skin coverage includes authored superficial structures

- **What:** the skin is pushed out where the authored great auricular nerve (three segments), external jugular vein,
  superficial temporal artery, auriculotemporal nerve or temporalis would come within 3 mm of it.
- **Why:** the adult male head is narrower behind the ear and would otherwise expose them.
- **Could affect:** local skin contour behind and in front of the ear; apparent depth of those structures.
- **Checks:** `face_fit` depth table (all ≥ 2 mm; shallowest now the posterior great auricular branch, 2.9 mm).
- **Human review:** whether these literature-drawn superficial structures sit at a plausible depth.

## 3. Fat and SMAS bands extended over the whole operative field

- **What:** the constant-depth bands (`layers.py`: fat 2–7 mm, SMAS 7–8.3 mm below the skin, unchanged) had a 22 mm
  sphere cut out around the ear canal and stopped at a field box (y ≥ 30, z 160–300 mm). The auricle is now excluded by
  thickness (morphological opening, tissue thinner than about 8 mm), and the box is y −15–170, z 150–318 mm. Fat
  107 → 207 mL and SMAS 26 → 52 mL within the field. The preauricular fat is restored.
- **Why:** the raised flap showed holes where the bands stopped short of it.
- **Could affect:** the layer seen between skin and parotid fascia in front of the ear, over the mastoid and
  sternocleidomastoid behind it, in the temple above the zygomatic arch, and low in the neck. A constant-depth band
  labelled SMAS now also covers regions where the corresponding layer is the temporoparietal fascia (above the arch)
  or the platysma (neck), and it lies over the mastoid.
- **Checks:** none specific to the bands; the build logs their volumes. No check covers their anatomical extent.
- **Human review:** **needed.** Is a continuous SMAS band acceptable in the temple, over the mastoid and in the neck
  for a lay/clinical atlas, and is the restored preauricular fat thickness plausible?

## 4. Flap membership and the fat following the skin

- **What:** (a) the fat now takes its flap membership only from non-auricular skin; (b) within 20 mm the fat takes the
  nearest skin's incision distance, position along the incision and flap weight, instead of computing its own from its
  lateral projection; (c) the eyes are hidden while the flap is raised (it folds over them).
- **Why:** a hole at the ear root, and windows in the raised flap where the thick, curved fat crossed the fold
  at other places than the skin.
- **Could affect:** where the fat is cut, how far forward it lifts and whether the flap reads as one skin-fat layer.
  The incision path, flap hinge and maximum angle are unchanged (162 mm modified Blair).
- **Measured (pre-pass → final):** skin flap vertices 22,884 → 18,429 (the mouth lining no longer counts, item 6);
  auricle vertices excluded 4,871 → 3,594 (new auricle). Fat flap vertices 21,791 → 22,338; excluded 2,369 → 1,921.
- **Checks:** `incision_flap` checks only that skin and fat both carry flap fields. Coincidence of the fat and skin
  incisions was verified visually on the flap plates, not measured.
- **Human review:** **needed.** Flap thickness and plane (plate 27 claims the skin and fat lift "in the layer just
  outside the gland's capsule"; the SMAS band is not drawn in that plate); the flap's anterior extent and its torn
  front notch (a pre-existing modelling limit).

## 5. Alternate tail tumour pinned to its validated centre

- **What:** `tumour_alternates.tail.keep: [69.5, 88.5, 220.0]`. The search tries the previously validated centre
  first and keeps it while every constraint holds.
- **Why:** skin cover is one of the search constraints, so the new skin moved the automatic placement by 1.5 mm.
- **Could affect:** the tail variant's relations to nerve, vessels and skin.
- **Measured:** centre, size (15.9 mm), nerve clearance (1.43 mm) and vessel clearance (5.83 mm) are identical to the
  pre-pass build; skin cover 2.38 → 2.6 mm.
- **Checks:** `tumour_alternates` (nerve ≥ 1.2 mm, vessel ≥ 0.8 mm, bone/muscle ≥ 0.4 mm, skin cover ≥ 2.2 mm,
  fraction in the tail ≥ 45%).
- **Human review:** as before the pass; nothing new.

## 6. Generic mouth lining trimmed (defect found and fixed in this audit)

- **What:** the MakeHuman face carries a closed mouth lining that runs several centimetres behind the lips. The new base
  reached 13 mm further back (to y 64.6 mm), touching the mandible (0.04 mm) and 6.3 mm from the deep lobe. In the
  head-clipped plates it appeared as a skin-coloured outline across the donor's CT (plate 15) and beside the deep lobe
  (plate 43). It also became the "skin" nearest the deep-lobe tumour (reported cover 18.7 → 10.3 mm).
- **Fix:** `face.py trim_mouth` keeps the lining within 8 mm of the face surface and caps the cut. The outer skin
  surface is unchanged (15,904 vertices identical; 1,280 lining vertices removed, all within 47 mm of the midline).
- **Measured after the fix:** deep tumour skin cover back to 18.9 mm; nearest skin to the mandible 1.9 mm; depth
  table changes ≤ 0.2 mm (voxel sampling). The lining had also carried small flap weights (about 9,000 vertices with
  weight > 0, none above 0.5): it no longer moves with the flap. The skin `flap_vertices` count falls 22,863 →
  18,429 for that reason; vertices with flap weight > 0.5 are unchanged (32,167 → 32,132).
- **Side effect:** the flap's fold axis is read from a sampled lateral raster of the skin, and moved 2.0 mm laterally
  (RAS x 68.4 → 70.4). The skin surface there is at x 70.6, so the hinge now lies on the skin rather than 2.2 mm
  beneath it. The raster's sensitivity to sampling is a known fragility.
- **Checks:** `face_fit`, `tumour_alternates`; plates 15 and 43 re-inspected.
- **Human review:** none beyond confirming plates 15 and 43.

## 7. Other geometry with anatomical meaning

- **Parotid surface outline on the opening plate** (`locate`): drawn on the skin from the donor's superficial lobe,
  projected laterally (signed distance of its outline). **Human review:** does it read as the gland's surface marking?
- **Muscle and nerve fibre direction** (`_AXIS`): centreline tangents for tubes, principal or fan axes for muscles
  (masseter, sternocleidomastoid, digastric, temporalis). It orients only the surface striation. **Human review:**
  fibre direction of the masseter and the SCM.
- **Exterior body** (neck below the scene cut, shoulders) has no anatomy beneath it and is excluded from the depth
  checks; the upper neck above the cut is the donor fit.

## Summary for the reviewer

| Item | Automated check | Clinical review |
|---|---|---|
| 1 Face base | `face_fit`, `exterior` | Skin thickness; posterior-neck residual patch |
| 2 Coverage | `face_fit` depth table | Depth of superficial structures |
| 3 Fat/SMAS extent | none (volumes logged) | **Required** |
| 4 Flap fields | `incision_flap` (presence only) | **Required** |
| 5 Tail tumour pin | `tumour_alternates` | As before |
| 6 Mouth lining | `face_fit`, `tumour_alternates` | Confirm plates 15, 43 |
| 7 Outline, fibres | none | Required (visual) |
