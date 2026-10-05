# Approved visual benchmarks

The final presentation pass keeps a picture of each approved hero state. A later change must not degrade one merely
to improve another scene; reopen a benchmark only for a concrete defect, an anatomical correction, performance, or
a side-by-side improvement.

| Benchmark | Plate | What it must show |
|---|---|---|
| `opening` | `face` | A finished adult head, neck and shoulders in profile; hair clear of the ear; the parotid footprint as a fine contour; the cyclorama field. |
| `localisation` | `where-parotid` | The gland exactly where the contour was, the skin faded to a faint orientation shell. |
| `nerve-operative` | `bed` | The facial-nerve fan on the deep lobe in the whole wound, the raised flap at the edge of the field. |
| `explore` | `explore` | The finished plate handed over: gland, nerve, tumour, muscle and bone under a neutral studio light. |

Pictures are capture-mode renders at 1600×1000 (deterministic settled frame, centred subject, no overlays), WebP.

- Compare the current build with the approved pictures (dev server running): `node tools/capture/benchmarks.mjs`.
  It prints the share of pixels that differ by more than 12/255 and the mean difference.
- Approve after a deliberate change: `node tools/capture/benchmarks.mjs --approve <id>`. Say why in the commit.
