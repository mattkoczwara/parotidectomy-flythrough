# ADR-0003: Field colour and look-development baseline

- **Status:** accepted (M1, 2026-09-28); field superseded by ADR-0005
- **Context:** plan §5 asks for a near-neutral, very low-chroma field (OKLCH L ≈ 0.24–0.28, C ≤ 0.02), not black, cream or teal, A/B tested in M1 against neutral graphite on real tissue. The M1 stylesheet had `#2d3330` (OKLCH L 0.314, C 0.010), lighter than that range.

**Contents:** Candidates · Decision · Look-development baseline recorded with this decision · Consequences

## Candidates

Both were rendered on the real slice (plates 1, 2 and 8; WebGPU, High tier, 1600×1000). The comparison is in `docs/qc/lookdev/field_ab.jpg`.

| | Colour | OKLCH L / C / h | CIE L* |
|---|---|---|---|
| A: drape | `#252a28` | 0.279 / 0.008 / 170° | 16.5 |
| B: graphite | `#272727` | 0.273 / 0 | 15.6 |

**Measured (tissue pixels, median L\*):**

| Plate | A: drape | B: graphite |
|---|---|---|
| Plate 2 | 35.9 | 35.9 |
| Plate 8 | 58.3 | 54.5 |

Tissue is unchanged by the field choice, apart from edges and the ghosted skin.

The luminance rule is that focus structures sit at least 15 L\* above the field. It is enforced per plate by the capture suite, which samples the canvas at every labelled focus structure. The rule does not apply to faded context: ghosted and dimmed skin sits close to the field by design.

## Decision

**A, the drape field, is used** (`--field` in `apps/site/src/styles/atlas.css`; the stage reads the same CSS value, so the page and canvas cannot drift apart).

- Its slight green-grey sits opposite the warm tissue hues. Skin and gland separate from it without any chroma in the chrome, while graphite made the skin read faintly magenta beside it.
- It keeps the surgical-drape reference the plan intends, at a lightness inside the plan's range.

`?field=graphite` remains as a look-development switch; it has no other effect.

## Look-development baseline recorded with this decision

These values came out of the same pass and are kept in `packages/stage/src/materials.ts`.

- **Skin:** `#c99c86`. The wrap-SSS strength is 1.4, down from 4, which had made the skin read as red glow.
- **Gland:** SSS strength 3.
- **Fat:** `#f2d27a`. The raised flap's underside faces away from the key light, and the old base read as khaki-olive in that shadow.
- **Hemisphere ground:** warmed to `#322c28`. It was greenish, which tinted under-lit fat.
- **Incision ink:** gentian violet `#4b2c6f`, matte, a 1–1.6 mm line. It is the only violet in the atlas (plan §5).

## Consequences

- Label scrims and the `--scrim` / `--field-deep` tokens follow the new field.
- All static figures are recaptured.
- A later change to the field needs a new A/B test with the same measurements.
