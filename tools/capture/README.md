# Plate capture

Playwright harness, added in M0 with the renderer spike:
- determinism checks (cold load vs forward scrub vs backward scrub at each plateau, under 0.5% pixel difference);
- visual regression baselines;
- static fallback plates;
- clinical review packet images.

Output goes to `output/` (gitignored).
