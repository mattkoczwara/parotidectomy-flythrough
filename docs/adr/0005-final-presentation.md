# ADR-0005: Final presentation layer — exterior, tissue materials, light and field

- **Status:** accepted (final presentation pass, 2026-10-04)
- **Context:** The anatomy, evidence and timeline were complete; the presentation was not. The opening was a bald,
  androgynous head cut flat at the neck, with a muscle stump hanging below it. Tissues were flat single colours. The
  lighting was one rig switched abruptly between presets, and the field was a green-grey drape. The owner's brief for
  the final pass asks for idealised clinical realism: a dignified human exterior, biologically convincing tissue,
  authored light that blends between shots, and a dark seamless cyclorama. Anatomy stays frozen.

## Decisions

### Exterior (presentation only, no claims)

- The generic face is the MakeHuman base mesh with MakeHuman's own **macro modifiers** for an adult male of about 40,
  with the three ancestry targets mixed equally (CC0, the same archive as before). The raw base mesh is the
  androgynous neutral that MakeHuman never shows unmodified. The donor is male. The fit to the CT is unchanged in
  method. The conform-region residual is unchanged (median 0.66 mm), and every depth check still passes. The
  superficial great auricular nerve, external jugular vein, superficial temporal artery, auriculotemporal nerve and
  temporalis are now part of the skin-coverage rule, so the adult male's narrower head behind the ear cannot expose
  them.
- An **exterior body** (neck below the scene cut, shoulders, upper chest) is cut from the same fitted surface by the
  same plane, so the seam vertices match exactly. `exterior.py` welds the normals across the seam. The body has no
  anatomy beneath it and follows the skin's authored state.
- **Hair and brows** are alpha-tested shells over a root surface taken from the scalp (`exterior.py`): a short,
  combed-back adult cut, tapering to the sides. The hairline is authored and checked to keep the ear, the
  preauricular skin and the parotid region clear. The hair dissolves strand by strand before the skin is ghosted.
- A **regional tint** on the skin (flushed ears, nose and cheeks, lips, brow skin and upper lash line, scalp under
  the hair) uses the vertex sets of MakeHuman's own targets.

### Tissue materials

Each family has macro, meso and micro structure, as a function of the rest position: gland lobes and lobules with pale
septa, nerve fascicles and faint transverse banding, muscle fascicles in the fibre direction, adipose lobules, vessel
walls, porous chalky bone, and a bosselated tumour capsule with chondromyxoid patches. The patterns stay fixed to the
tissue through every fold and pose, and they are deterministic. The fibre direction is baked at export (`_AXIS`):
centreline tangents for tubes, principal or fan axes for muscles. Colours were recalibrated under a neutral rig.
Major tissues differ in form, roughness and relief, not only in hue.

**Noise comes from a texture, not from shader code.** The first version used procedural Perlin and worley noise
(MaterialX nodes), inlined at every call site. The tissue shaders became so large that compiling them in the GPU
process held the first picture for about 15 s; first convergence went from 8.4 s to 19.7 s, and 1440p p95 doubled.
All noise now samples one tileable 64³ RGBA volume, generated from a fixed seed at load (`packages/stage/src/
noise.ts`): smooth noise, worley F1/F2 and a second independent noise. First convergence is back to about 9.4 s, and
1440p p95 is 16.8 ms again.

**Firefox.** Shaders must not hold `smoothstep()` of constants. Firefox's WGSL validator (Naga) rejects them, and they
appear wherever a material reads an attribute its geometry lacks. Optional fields are switched on per geometry
(`pieceFields`, `axis`, `locate`).

**Kept placements.** The alternate tail tumour's search could move when the exterior skin changes, because skin
cover is one of its constraints. It now keeps its validated centre while that centre stays feasible (`keep` in
`anatomy.yaml`).

### Light

The timeline now carries `light.mix`: the preset as continuous weights, cross-faded with the camera, so a change of
shot never cuts the light. The stage blends four looks. `portrait` is derived, not authored: it is the studio look
while the intact exterior is showing. The others are `studio`, `operative` and `specimen`. The environment is an
authored studio (a dark sphere, a large soft key box, a cool fill, a rim strip and an overhead panel), not a room.
The fill light is camera-relative, slightly below the view, like an operating light along the surgeon's view, so
surfaces turned toward the viewer (the raised flap's underside, the depth of the wound) never go black. Context
dimming moves toward a warm grey, because a neutral grey turned dimmed fat khaki.

### Field

The field changes from the drape (`#252a28`, ADR-0003) to a cool charcoal cyclorama: `#1d1f22` at the edges (OKLCH L
0.236, C 0.006, h 255). The canvas lifts it softly behind the subject (about +4.5% lightness), and the lift follows
the framing. A slightly deeper lower edge reads as a cyclorama's floor falloff, and a fixed per-pixel dither prevents
banding. The page reads the same `--field`. The capture suite's rule, focus structures at least 15 L* above the
field, still applies.

## Consequences

- The anatomy asset is rebuilt. Two clean builds must still give a byte-identical `slice.glb`.
- All static figures are recaptured. The ADR-0003 field A/B switch (`?field=`) remains for look development only.
- Plates may set `light.preset`. Nothing authored has to change for the blend.
