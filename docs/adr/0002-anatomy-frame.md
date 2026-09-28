# ADR-0002: Canonical anatomy frame is the Visible Human male normal CT

- **Status:** Accepted
- **Date:** 2026-09-28
- **Context:** M0 registration spike (plan §0, §7, §13 risk 1)

## Question
Do the candidate open sources share one coordinate frame closely enough to combine them directly? The sources are:
- the Human Reference Atlas (HRA) Visible Human male meshes;
- TotalSegmentator segmentations of the Visible Human male normal CT;
- the Visible Human cryosection photographs.

The plan's criterion was a mean surface distance under 2 mm between the HRA and TotalSegmentator mandibles, plus the parotid overlaid on cryosection levels.

## What was measured
Pipeline:
- `pipeline/sources/fetch.py`
- `pipeline/segment/{build_ct_volume,segment,register}.py`

QC output is in `docs/qc/m0-registration/`.

**CT volume.**
- The head/neck normal CT has 230 GE Genesis slices, acquired in five series with fields of view from 250 to 460 mm.
- Each slice is placed from the patient R/A/S corner coordinates in its header, then resampled to 0.75 × 0.75 × 1 mm.
- The table position agrees with the slice numbering to within 0.5 mm.
- **Laterality was checked against anatomy, not assumed:** the aortic arch and its wall calcification lie on the header's R− side, so R+ is the patient's right. TotalSegmentator's side labels agree.

**Segmentation.** The five Apache-2.0 head/neck tasks ran on the RTX 3070.

| Structure | Result |
|---|---|
| Parotid | 18.2 mL (R), 21.6 mL (L); consistent with the 18.1 g mean in Pujol-Olmo 2020 |
| Masseter, mandible, SCM, IJV, submandibular | Plausible on axial, coronal and sagittal overlays |
| Digastric | Only fragments (0.5 mL) |
| Styloid, zygomatic arch | Only fragments (about 0.13 mL each) |
| Internal carotid | Empty; the cadaver CT has no contrast |

**HRA versus CT, after rigid PCA-seeded ICP on the mandible (proper rotation only):**

| Measure | Mean | Median | p95 |
|---|---|---|---|
| Mandible | 5.7 mm | 5.1 mm | 15.2 mm |
| Parotid, right to right | 12.0 mm | — | — |
| Parotid, left to left | 12.8 mm | — | — |

- A similarity fit wants a scale of 1.05.
- Sides are consistent, and the frames have the same handedness.
- An early apparent mirror between the frames was a bug in the alignment code (a PCA seed with determinant −1). It is fixed.
- **The < 2 mm criterion fails.** The HRA meshes are the same body but not the same state or frame. They are consistent with a model built from the frozen cryosection block and then remodelled.

**Cryosections versus CT.**
- The normal CT was acquired before freezing, in a different posture. At equal slice numbers the anatomical level differs by up to about 30 mm, and the two do not differ by a single rigid transform.
- Three automatic methods all failed to give a stable, anatomically verified result:
  - per-level 2D outline ICP;
  - a 3D ring-to-skin similarity fit (it converged with about 4.4 mm skin residual, but the pose was anatomically wrong);
  - a per-level mutual-information search (inconsistent levels and rotations between neighbouring photographs).

  Head outlines are too featureless, and the posture change is non-rigid.

## Decision
1. **The canonical frame is the normal-CT RAS frame** (`pipeline/segment/work/vhp_male_ct_head.nii.gz`). Every shipped structure is expressed in it.
2. **The parotid, masseter, mandible, SCM, IJV, submandibular gland and skull come from TotalSegmentator.** They are remeshed and smoothed in the pipeline.
   - The HRA parotid is kept as a morphology reference only.
   - This reverses plan §7's "HRA parotid as the clean base": it is not registered to the frame the rest of the anatomy lives in.
3. **Thin or poorly segmented structures are authored from specs, not taken from segmentation.** These are the digastric posterior belly, styloid process, zygomatic arch refinement and the ICA/ECA. The CT and segmented neighbours constrain them, as for the facial nerve, retromandibular vein and great auricular nerve.
4. **The cryosections are registered locally by landmarks in M1**, around the parotid region, for tracing the nerves and vessels and for visual QC. Examples of landmarks: the posterior border of the ramus, mastoid tip, external acoustic meatus, styloid base, posterior belly of the digastric and the dens.
   - Automatic whole-head methods are not used.
   - Tracing needs about 150 more photographs (about 500 MB), which is a separate download approval.

## Consequences
- Plan §7's table and §13 risk 1 are updated. M0 closes with the criterion recorded as **failed and resolved by design**, not waived.
- Visual QC for segmentations uses overlays on the CT they came from (`docs/qc/m0-registration/ct_*.png`). Cryosection QC of authored structures follows the M1 landmark registration.
- The CT has 3 mm spacing below slice 1162, so the inferior parotid and the marginal mandibular region have coarser segmentation. Authored geometry there relies on the specs and literature.
- Series-boundary banding is visible in the resampled CT. It does not affect the segmentations used, but it limits CT-derived detail at those levels.
