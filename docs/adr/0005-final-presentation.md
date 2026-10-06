# ADR-0005: Final presentation layer — exterior, tissue materials, light and field

- **Status:** accepted (final presentation pass, 2026-10-04)
- **Context:** The anatomy, evidence and timeline were complete; the presentation was not. The opening was a bald,
  androgynous head cut flat at the neck, with a muscle stump hanging below it. Tissues were flat single colours. The
  lighting was one rig switched abruptly between presets, and the field was a green-grey drape. The owner's brief for
  the final pass asks for idealised clinical realism: a dignified human exterior, biologically convincing tissue,
  authored light that blends between shots, and a dark seamless cyclorama. Anatomy stays frozen.

**Contents:** Decisions › Exterior (presentation only, no claims); Tissue materials; Light; Field · Amendment: the opening portrait (2026-10-05) · Amendment: the opening interface (2026-10-05) · Amendment: the opening hero asset (2026-10-06) · Consequences

## Decisions

### Exterior (presentation only, no claims)

- The generic face is the MakeHuman base mesh with MakeHuman's own **macro modifiers** for an adult male
  (CC0, the same archive as before). The raw base mesh is the
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

**The raised flap carries its fat.** The fat and SMAS bands (constant-depth layers, `layers.py`) had a 22 mm sphere
cut out around the ear canal and were limited to a field box (y ≥ 30 mm, z 160–300 mm) smaller than the raised flap, which reaches higher and, along the neck limb of the incision, further back. The raised flap therefore
showed holes through which the skin's inner shell appeared. The auricle is now excluded by thickness instead (a
morphological opening of the head mask removes tissue thinner than about 8 mm). The field box is y −15–170 mm and z 150–318 mm. The
fat follows the skin directly above it: it takes the nearest skin's cut distance and flap weight, not its own lateral projection, which put the deep face of the curved slab across the fold at other places and opened windows in the raised flap. It inherits only from non-auricular skin. A raised flap also hides the eyes, because it folds forward over them. Fat 107 → 207 mL and SMAS 26 → 52 mL within the field;
all anatomy checks pass. These are the same constant-depth bands as before, now complete over the operative field.

**Kept placements.** The alternate tail tumour's search could move when the exterior skin changes, because skin
cover is one of its constraints. It now keeps its validated centre while that centre stays feasible (`keep` in
`anatomy.yaml`).

**The mouth lining is trimmed (acceptance audit, 2026-10-05).** MakeHuman's face carries a closed mouth lining that runs
several centimetres behind the lips. With the adult male base it reached 13 mm further back, touched the mandible and
came within 6 mm of the deep lobe. In the plates that clip the head it drew a skin-coloured outline across the donor's
CT (plate 15) and beside the deep lobe (plate 43). `face.py` now keeps the lining within 8 mm of the face surface and
caps the cut. The outer skin is vertex-for-vertex unchanged. The audit of every geometry change in this pass is
`docs/qc/final-pass-clinical-manifest.md`.

### Light

The timeline now carries `light.mix`: the preset as continuous weights, cross-faded with the camera, so a change of
shot never cuts the light. The stage blends four looks. `portrait` is derived, not authored: it is the studio look
while the intact exterior is showing. The others are `studio`, `operative` and `specimen`. The environment is an
authored studio (a dark sphere, a large soft key box, a cool fill, a rim strip and an overhead panel), not a room.
The fill light is camera-relative, slightly below the view, like an operating light along the surgeon's view, so
surfaces turned toward the viewer (the raised flap's underside, the depth of the wound) never go black. Context
dimming moves toward a warm grey, because a neutral grey turned dimmed fat khaki.

### Field

The field changes from the drape (`#252a28`, ADR-0003) to a cool charcoal cyclorama. The canvas lifts it softly behind the subject, and the lift follows
the framing. A slightly deeper lower edge reads as a cyclorama's floor falloff, and a fixed per-pixel dither prevents
banding. The page reads the same `--field`. The capture suite's rule, focus structures at least 15 L* above the
field, still applies.

## Amendment: the opening portrait (2026-10-05)

The owner's goal reference for the first view (`docs/references/`, not shipped) is a lean, athletic adult with short
textured hair, a warm key and rim light and a near-black field. The fitted exterior cannot be that figure: its jaw and
upper neck are the donor's (a heavy-set man) wherever anatomy lies beneath, and the gland, nerves and incision are
registered to that skin. The opening therefore shows a **portrait** that settles into the fitted exterior.

- **A morph, not a second head.** `portrait.py` deforms the same MPFB base mesh with MakeHuman's macro and feature
  targets (more muscle, less weight, ideal proportions, a slimmer jaw line with a firmer chin; anatomy.yaml
  `portrait`). It places the result by the head fit's own per-axis scale and translation, recovered exactly from the
  eyes. It turns and lowers the torso slightly under the profile head, then applies the same Loop subdivision, so the
  two surfaces correspond vertex for vertex. The displacement is baked onto the fitted skin, exterior body, eyes and
  hair root as `_PDISP`, with the portrait's normals as `_PNRM`. The fitted positions, normals and indices are
  unchanged.
- **Driven by the timeline.** Op `portrait` is 1 on the opening and falls to 0 over the first 35% of the transition to
  plate 2, before the skin is ghosted (structures change from 45%). The stage blends `U.portrait`, the op times the
  intact-exterior test. While it is above 0, nothing beneath the exterior is drawn: the leaner portrait does not
  contain the donor's anatomy. Once the morph is complete, the opaque fitted skin hides it anyway.
- **Its own haircut.** Op `groom` holds until the skin has faded past the hair's fade. The portrait hair is a short
  shell under-layer and about 5,000 baked ribbon cards (`groom.py`). The cards are seeded, clumped and turned, rise
  above the scalp, and face the fixed opening camera, so nothing is billboarded at run time. They ride the scalp
  through the morph and dissolve strand by strand. The fitted shell hair waits. The hairline keeps the ear and the
  parotid region clear (checked).
- **Skin, light and field, weighted by the morph.** The portrait's skin field (`_PORT`: beard shadow, auricle, T-zone,
  scalp) adds a warmer tone, the stubble, pores and broad roughness patches. A `hero` look takes the portrait's share
  of the light: a warm key from in front of the face, almost no fill, and a strong warm rim. The rim's colour and
  direction are now per look. The field deepens to a blue-black with a cooler, tighter glow. At `U.portrait` = 0,
  every one of these is exactly the previous state.
- **Not changed:** anatomy, claims, the donor-fitted surface and the other plates (their benchmarks are unchanged within
  edge noise). The opening's `<Model>` text says the figure is idealised and settles into the donor's shape.
- **Second pass (same day): form at the scale it is seen.**
  - **Face:** feature targets (brow ridge, cheek hollow, lip line, nasolabial fold, nose bridge, smaller ears, more
    open eyes) and a baked **cavity** (the depth below the Gaussian-weighted local surface, in `_PORT.y`) that shades
    the creases. The shader adds broader colour and redness mottling, a beard shadow that reads at the opening's
    distance, darker lips and lash line, and softer, patchier specular.
  - **Neck and shoulder:** an analytic **relief**, not new geometry. Eight muscles (sternocleidomastoid heads and
    groove, clavicle, supraclavicular hollow, trapezius, laryngeal prominence, deltoid) are polylines built from
    landmarks found on the portrait surface (`portrait.relief`, exported to `frame.json`). The stage evaluates
    h = Σ height·exp(−d²/width²) on each muscle's polyline distance in the portrait's object space. It tilts the
    normals by the analytic gradient (capped) and lifts the dense skin a little. The coarse shoulder mesh is only
    shaded, the lift fades out at the neck cut and around the auricle, and the skin's inner face moves with the
    outer face.
  - **Hair:**
    - lock-length jitter and tufts on top, and a crown whorl in the comb field
    - about 3% flyaway cards, drawn as single strands
    - rounder, more varied locks
    - a sparser, softer hairline with covered temples
    - a shorter, darker shell under-layer and fuller brows.
  - **Framing:** the framing box gets a fixed hair allowance, so grooming never moves the camera.
  - **Bytes:**
    - The fitted hair no longer carries the morph (it is hidden while the portrait shows).
    - The skin's inner face carries no portrait field.
    - Scalp shells and cards are kept only where they face the opening's camera envelope (plate 1 and the
      transition to plate 2), and the shells are subdivided only along the hairline. Their length is stored
      quantisable.
    - About 4,200 cards (3,500 kept) look the same as 6,000.
    - The scene went from 6.49 to 6.11 MB.
- **Gotchas found:**
  - The skin's fragment stage was at WebGPU's 16 inputs, so its scalar fields now travel packed (two varyings
    instead of six).
  - The Neutral tone mapping's toe subtracts about the smallest channel from dark colours. A dark brown hair albedo
    therefore rendered a saturated orange, so the hair's albedo is now a near-neutral mid grey-brown.

## Amendment: the opening interface (2026-10-05)

The opening view's chrome was brought to the goal reference (`docs/references/`). The masthead, chapter rail, control bar, instrument pill, orientation tile, depth gauge and the opening card now share one panel recipe and one right-hand anchor (`--edge`, `--edge-top`, `--bar-h`, `--tile-w` in `atlas.css`).

- **Gilt accent.** `--gilt` (#c9a46c) marks state and emphasis in the chrome only: the chosen reading depth, the current chapter and depth plane, the instrument pill, the eyebrow rule and the orientation marker. It never colours tissue or schematic content. The ochre of ADR-0004 is unchanged and still belongs to the Complications schematics.
- **Opening card.** The first chapter's eyebrow and the first plate draw as the two halves of one card, both in normal flow, so the scroll bands and the timeline are unchanged. The larger display type is scoped to that plate; the later plates keep their card.
- **Deliberate departure from the reference.** The instrument pill keeps dark text on gilt. White text on that gold would fall below the WCAG contrast for text at that size.

## Amendment: the opening hero asset (2026-10-06)

Tuning the morph portrait had reached its ceiling: MakeHuman's low-resolution surface, card hair and noise-driven
skin still read as CG beside the goal reference. The owner chose a separate, presentation-only hero asset for the
opening, drawn in real time, which hands off to the fitted exterior before any anatomy shows. The goal reference is
art direction, not a likeness target.

- **Source.** A scanned real head (Lee Perry-Smith / Triplegangers, CC BY 3.0) was rejected at a likeness gate: no
  release covering a tumour atlas could be established (`docs/qc/hero-likeness-gate.md`). The hero is built from
  Blender Studio's Human Base Meshes (CC0, a synthetic sculpt; `pipeline/sources/human-base-meshes-1.4.1.json`).
- **Asset.** `pipeline/blender/hero.py` (headless Blender; inputs from `pipeline/anatomy/hero_prep.py`; spec
  `anatomy.yaml` `hero`) evaluates the realistic male figure's multires sculpt twice: the realtime mesh and the surface
  its detail is baked from. Both are placed on the fitted eyes and shaped by the same authored edits: posture, skull,
  ears, local facial sculpt, an athletic neck, and muscle and bone relief along the normal. They are cropped to a bust.
  The groom (`groom.py`) is seeded strands for the scalp, brows and lashes, exported as ribbons. The skin maps
  (`skin.py`) are baked in Cycles: an albedo from authored region fields, a normal map from the bake surface plus
  authored micro-relief, and an ORM map (occlusion, roughness, thickness). It ships as `hero.glb` and three WebP maps.
  The finished figure is turned 7 degrees toward the camera.
- **Drawing.** `packages/stage/src/hero.ts`: the skin is a subsurface material on the baked maps, with a portrait
  falloff below the jaw. The hair ribbons turn toward the camera in the vertex stage, at least about a pixel wide, and
  are drawn opaque under TRAA. The hero alone casts and receives the key's shadow. The `hero` look's key moved in front
  of the face and its rim behind the camera-side silhouette. The opening's framing box (`portrait_bust`) comes from
  the hero's head.
- **Handoff.** `handoff.py` bakes each hero vertex's displacement onto the fitted surface:
  - a thin-plate warp on landmarks found alike on both surfaces, with the ears anchored at the donor's ear-canal
    landmark;
  - the closest point on the fitted surface, smoothing, and a second projection.

  It also carries over the fitted skin's outline field (`foot`), so the opening's outline is the donor's, placed by
  that correspondence. As the portrait weight falls:
  1. the hero morphs onto the fitted shape and turns back (p 1 → 0.35);
  2. its hair dissolves strand by strand while the fitted hair comes in (p 0.5 → 0.3);
  3. its skin dissolves per pixel over the fitted skin (p 0.3 → 0), lifted about 1 mm along the normal so the two
     surfaces never z-fight.

  Anatomy stays hidden until the portrait weight is 0, as before.
- **The morph portrait** is not used while `hero.glb` loads: the fitted surfaces keep their own shape (`U.morph` = 0).
  Its code and baked attributes stay until the owner approves the hero. Then they come out of the exporter and the
  stage.

## Consequences

- The anatomy asset is rebuilt. Two clean builds must still give a byte-identical `slice.glb`.
- All static figures are recaptured. The ADR-0003 field A/B switch (`?field=`) remains for look development only.
- Plates may set `light.preset`. Nothing authored has to change for the blend.
