# Approved visual benchmarks

**Contents:** Benchmark table: `opening` · `localisation` · `nerve-operative` · `explore` · Re-approvals

The final presentation pass keeps a picture of each approved hero state. A later change must not degrade one merely
to improve another scene; reopen a benchmark only for a concrete defect, an anatomical correction, performance, or
a side-by-side improvement.

| Benchmark | Plate | What it must show |
|---|---|---|
| `opening` | `face` | The opening portrait (ADR-0005 amendment): a lean adult in profile, head, neck and shoulder; short textured hair clear of the ear; warm key and rim light; the parotid footprint as a fine contour; the deep blue-black field. |
| `localisation` | `where-parotid` | The gland exactly where the contour was, the skin faded to a faint orientation shell. |
| `nerve-operative` | `bed` | The facial-nerve fan on the deep lobe in the whole wound, the raised flap at the edge of the field. |
| `explore` | `explore` | The finished plate handed over: gland, nerve, tumour, muscle and bone under a neutral studio light. |

**Goal reference for the starting view.** `docs/references/Parotid Atlas - Goal Reference.png` (kept locally and
not published: its origin is not recorded) is the owner's target for the `face` plate as first seen: a finished adult in right-facing profile, head, neck and
shoulders, on a dark field with a warm key and rim light; the parotid footprint as a fine contour in front of the ear;
the subject to the right of the plate text, with the masthead controls, chapter rail and depth gauge around it. It is
an aspiration for the look and composition that `opening` is judged toward. Comparisons still run against the
approved `opening.webp`. It is not anatomical evidence, and its text is not plate content. It was supplied by the
owner and is not shipped with the site.

Pictures are capture-mode renders at 1600×1000 (deterministic settled frame, centred subject, no overlays), WebP.

- Compare the current build with the approved pictures (dev server running): `node tools/capture/benchmarks.mjs`.
  It prints the share of pixels that differ by more than 12/255 and the mean difference.
- Approve after a deliberate change: `node tools/capture/benchmarks.mjs --approve <id>`. Say why in the commit.

Re-approvals: `opening`, 2026-10-05, second portrait pass: facial form and cavity, beard shadow, neck and shoulder
relief, groom breakup. With the same scene file, the other three render identically before and after this pass
(0.00%, 0.00%, 0.01%). `opening`, 2026-10-05 (portrait pass): the opening now shows the portrait morph, its haircut, the `hero`
light and the deeper field, framed like the goal reference. The other three differ from approval by 0.11%, 0.51% (the
raised flap's and the wound's edges only) and 0.04%. `nerve-operative`, 2026-10-05 (acceptance audit). The generic mouth lining no longer shows as pale
skin-coloured surfaces deep in the wound, and the flap's fold axis moved 2 mm onto the skin surface
(`docs/qc/final-pass-clinical-manifest.md`, item 6). The other three benchmarks differ from approval by 0.3% of pixels
or less.
