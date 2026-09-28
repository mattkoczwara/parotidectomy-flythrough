# Interactive Parotid Surgery Atlas: Integrated Plan

## Context

The repository is empty. It holds only the brief (`docs/planning_prompt.md`) and a starting bibliography (`docs/parotid_surgery_atlas_research_references.md`). The goal is a public educational website. It explains parotid tumours and parotidectomy through a high-fidelity, scroll-controlled 3D dissection. Pleomorphic adenoma (PA) is the teaching pathway. The site should work for patients, medical students and clinicians.

This plan comes from three parallel research passes: medical evidence, anatomical geometry and licensing, and rendering technology and precedents. An architecture review then stress-tested the draft direction.

**Owner decisions:**
- Missing anatomy will be **authored as reproducible Blender Python scripts**. No commissioned art and no commercial models.
- **Clinical review happens once the app is fully implemented.**
  - The build must therefore keep medical content and anatomy editable as data.
  - It must produce review packets continuously.
  - It must hold back public launch until that review is done.

**Machine:** Node 24, Python 3.14, Blender 4.2 and 5.2 (plus Blender MCP), RTX 3070 8 GB.

**Git setup:** git currently reports "dubious ownership". Commits need `git config --global --add safe.directory C:/Development/claude/parotidectomy-flythrough` first.

### Research findings that shaped the plan
- **No open dataset models the extracranial facial-nerve branches.**
  - BodyParts3D 4.0 (CC BY 4.0) has no parotid, masseter, facial nerve, external carotid or retromandibular vein.
  - The Human Reference Atlas (CC BY 4.0) has a clean Visible Human male parotid, submandibular gland and mandible, all in one frame.
  - TotalSegmentator's open tasks (Apache-2.0) can run on Visible Human CT. They produce the parotid, masseter, digastric, SCM, platysma, styloid, zygomatic arch, ICA, IJV, mandible, skull and auditory canal, all registered to one body.
  - The nerves, retromandibular vein (RMV), external carotid artery (ECA) branches, lobe split and soft-tissue layers must be authored.
  - Commercial meshes (Zygote, TurboSquid) forbid shipping raw glTF.
  - Z-Anatomy is CC BY-SA, and some of its sub-assets are NC. Avoid it unless a gap cannot be filled any other way.
- **Corrections needed in the bibliography:**
  - **Barrameda 2026 (PMID 41353726) is retracted** (2026-07-28).
  - The Rea/McGarry/Shaw-Dunn PMID and DOI in the references file point to a different paper (Kochhar 2016). The real paper is *Ann Anat* 2010, PMID 19883997.
  - Salzano 2025 (ECD vs SP) is a single-arm pooled analysis with internal numerical inconsistencies.
  - The Milan 2nd-edition risk-of-malignancy figures came from a secondary summary and need checking against the primary.
- **Commonly repeated "facts" that turned out to be weak or wrong:**
  - "80% of the gland is superficial": Pujol-Olmo 2020 gives about 61–69% by weight.
  - "Tragal pointer 1 cm": measured distances conflict across Witt 2005, Rea 2010, Pather 2006 and Cannon 2004.
  - Carcinoma-ex-PA risk figures trace to a single 1974 series.
  - Recovery and healing timelines are mostly institutional practice, not evidence.
  - The monitoring "disagreement" disappeared with the retraction. What remains: monitoring reduces immediate weakness, but its effect on permanent weakness is unproven (Buntain 2026).
- **Technology:**
  - three.js r186 `WebGPURenderer` is now the recommended path, with automatic WebGL2 fallback. TSL materials compile to both backends.
  - React Three Fiber's WebGPU-first release (v10) is still alpha.
  - Draco cannot compress morph targets. Meshopt can.
  - CSS scroll timelines are not yet in Firefox stable.
  - McKenna 2017 found stepper-style and scroller-style navigation produce equal engagement. Navigation feedback is what matters.

---

## 0. Execution gates

### Bootstrap gate: the first execution after approval does ONLY this, then stops
1. **Git prerequisite.**
   - Run `git config --global --add safe.directory C:/Development/claude/parotidectomy-flythrough`.
   - The repo has no commits yet, so rename the unborn branch `master` → `main` to match the stated main branch.
2. **Persist plan and state.**
   - `docs/plan.md`: this approved plan, verbatim.
   - `docs/STATUS.md`: current phase, completed gates, next step, open questions, the deferred clinical review.
   - `CLAUDE.md`: agent conventions:
     - the gates;
     - evidence rules;
     - "every sentence → claim";
     - no retracted sources;
     - provenance required;
     - pinned versions.
   - `docs/adr/0001-web-stack.md`: the stack is provisional until the M0 renderer spike passes.
   - Bibliography corrections in `docs/parotid_surgery_atlas_research_references.md`: the Rea PMID, the Barrameda retraction, the Salzano caveat, and the Milan figures to verify.
3. **Workspace.** A root `package.json` with npm workspaces, a shared `tsconfig.base.json`, `.gitignore` (node_modules, dist, raw pipeline data), `.editorconfig`, `.nvmrc` (Node 24).
4. **Web framework.** `apps/site` from Astro's **minimal (empty) starter** only. No theme, template, integration or styling boilerplate. One blank page.
5. **Packages and directories, at a minimal level:**
   - `packages/schema` (zod entry point, no real schemas yet);
   - `packages/timeline` (typed entry point plus one trivial Vitest test);
   - `packages/stage` (empty typed entry point, no three.js yet);
   - `pipeline/{specs,sources,segment,blender,build}` and `tools/{validate,capture}`, each with a README stating its purpose;
   - `docs/adr/`.
6. **Root commands:**
   - `npm run dev` (Astro dev server)
   - `npm run build`
   - `npm test` (Vitest across packages)
   - `npm run validate` (a TypeScript script that loads the schema package and checks the content directories; passes on empty content)
   - `npm run typecheck`
7. **Dependencies:** only `astro`, `typescript`, `vitest`, `zod` and `tsx` (to run the validator). No three.js, Playwright or UI libraries yet.
8. **Verify:**
   - `npm run build`, `npm test`, `npm run validate` and `npm run typecheck` all pass.
   - The dev server starts, and the blank page loads in the browser pane.
   - `.claude/launch.json` is added for the dev server.
9. **Checkpoint:** one clean initial commit, with the attribution trailer.
10. **STOP** and return control to the user.

### M0 renderer feasibility spike: must pass before the stack is locked
The spike uses a crude but representative parotid-and-nerve proxy: a lobulated closed gland mesh, a branching nerve tube at true relative calibre, a skin shell and a tumour. It must prove **all of the following together** on both the WebGPU backend and the **forced WebGL2 fallback**:
- the gland ghosted over the nerve (alpha-hash plus TRAA) without unacceptable shimmer during orbit;
- a cut surface: custom clip uniform with a `frontFacing` cap;
- peel deformation driven by a baked per-vertex field, scrubbed forward and backward;
- one skin or gland TSL material (clearcoat, sheen, wrap-SSS);
- the non-emissive focus contour;
- the required post-processing: GTAO and TRAA on High, with DOF optional;
- deterministic capture: Playwright frames at the same `t` from cold load, forward scrub and backward scrub differ by <0.5% of pixels;
- frame time within budget on the RTX 3070 and on throttled Mid.

**If it passes,** lock three.js r186 `WebGPURenderer` and record the result in ADR-0001.

**If it fails,** re-evaluate before any scene code depends on the renderer:
- WebGL2-only `WebGLRenderer` with TSL (supported since r184);
- Babylon.js 9;
- a partial offline or prerendered strategy for the failing feature.

`packages/stage` stays behind the `resolve(semantic) → RenderState` boundary. The timeline and content layers must not depend on the choice.

---

## 1. Product interpretation

**What it is:** one continuous, reversible dissection of a single anatomically registered head. Scroll moves the viewer through anatomical depth and surgical time. The text always describes the state currently on screen. At any point the viewer can stop and handle the specimen: orbit within limits, change tissue depth, and ask about any structure. The core lesson is one spatial idea. **The facial nerve runs through the gland and defines the surgical plane. Every decision in parotid surgery follows from that plane: where the tumour is relative to it, how the nerve is found, and how much gland is removed around it.**

**What it is not:**
- A patient-specific plan or a video substitute.
- A textbook with 3D illustrations.
- An anatomy browser with a story attached.
- A claim that one institution's operation is *the* parotidectomy.

## 2. Design direction

**Alternatives evaluated (these differ in product logic):**

| Concept | Strength | Why it was not chosen alone |
|---|---|---|
| **A. Atlas plates**: discrete explorable states, stepped | Robust, accessible, easy deep links and fallbacks | The operation is a *continuous transformation* (incision → flap → peel → removal). Cutting between plates forces the viewer to rebuild what changed, and the transformation cannot be scrubbed backward. |
| **B. Depth-dial instrument**: the scene is a tool; the main controls are tissue depth and resection extent | The most subject-specific option; clinicians would value it | Patients need a narrative. Incision, landmark navigation and specimen removal are not depth values. |
| **C. Story plus a separate sandbox** | Familiar, and separates the two concerns | The viewer must choose between reading and exploring, and the sandbox loses the narrative context. |
| **D. Continuous dissection (chosen synthesis)** | See below | — |

**Chosen direction: continuous dissection, authored plates, instrument on demand.**
- **Authoring unit (from A):** *plates* are authored rest states along a continuous timeline.
- **Readout (from B):** a persistent **plane gauge** shows how deep the viewer is. It becomes a control in instrument mode and in the final Explore chapter.
- **Instrument mode:** at every plate, the viewer can "take the instrument". That allows orbit within about ±35° of the authored view, the depth dial, and structure query. Any scroll returns the view to the authored pose. This is Segel & Heer's "martini glass" pattern at each plate, not only at the end.
- **One orientation throughout:** the patient's right side in anatomical lateral view, head upright, never rotated for drama. There is at most one optional "surgeon's view" plate, explained by the orientation glyph.

**Identity comes from the subject:**
- The anatomy fills the frame.
- Annotation follows the medical-atlas convention of margin labels with hairline leaders.
- One colour is borrowed from the operating room: gentian-violet skin-marker ink. It appears only as ink on tissue.
- **Rendering style encodes epistemic status.** Naturalistic shading means the structure is modelled anatomy. Line or hatch illustration means the content is schematic: pseudopodia, imaging outlines, Frey nerve regrowth, risk territories. "This is a simplification" becomes a visual grammar, not a caption.

## 3. Information architecture

**Narrative (chapters → plates).** The spine goes from normal anatomy, to pathology, to decisions, to the operation, to the aftermath:

1. **Orientation**: face, lump, where the parotid is, the orientation glyph introduced.
2. **Layers**: skin → subcutaneous fat → SMAS/parotid fascia → gland, with the gauge introduced.
3. **The nerve within**: the trunk emerges from the stylomastoid foramen → pes → divisions → five branch groups, at true scale. Also covers the nerve plane that divides the "lobes" (a surgical construct), and branching variants (Davis/Katz patterns shown as a small set of alternates).
4. **The tumour**:
   - Pleomorphic adenoma in the superficial lobe; common positions (superficial, deep, tail, accessory).
   - A magnified inset in schematic style showing pseudocapsule, pseudopodia and satellite nodules.
   - Why "popping it out" fails (Zbären & Stauffer 2007, Dulguerov 2017).
5. **Finding out**:
   - Ultrasound, MRI and FNA, with core biopsy mentioned.
   - Real Visible Human slices of *normal* anatomy, registered to the model. Any tumour appears only as a hatched drawn outline. No synthetic patient images.
   - Milan System categories as a structured explanation.
6. **Choosing the operation**:
   - ESGS levels I–V (Quer 2016) painted on the gland in marker ink.
   - Extracapsular dissection (ECD), partial superficial, superficial and total compared on the same gland.
   - How tumour size, mobility and depth move the options.
   - Evidence limits: selection bias, and the single-arm pooling in Salzano 2025.
7. **The operation** (one representative sequence, labelled as such): incision (modified Blair, with facelift as the variant) → skin flap above the parotid fascia → great auricular nerve (GAN) → SCM and posterior belly of digastric → tragal pointer, tympanomastoid suture and digastric converge on the trunk → pes → antegrade branch dissection → the lobe lifts off the nerve → specimen out.
8. **Closure**: haemostasis, barrier/SMAS options (as variants), drain, skin closure.
9. **Afterwards**: postoperative anatomy (what is gone, what remains, the contour change), the specimen and final pathology, and a healing timeline marked as institutional practice where the evidence is weak.
10. **Complications**: each one is mapped to the structure responsible and shown on the model:
    - Marginal mandibular branch → lower lip.
    - GAN → earlobe numbness.
    - Auriculotemporal nerve and sweat-gland reinnervation → Frey syndrome.
    - Plus sialocele, first-bite syndrome, recurrence and contour change.
    - Every number carries its population.
11. **Explore**: free instrument mode, and a side-by-side comparison of procedure extents.

**Three reading depths, one text.** A global *Essentials / Anatomy / Clinical* setting, remembered per viewer.
- The **primary text is identical** at every depth. It is plain language, uses correct terms, and glosses them on first use.
- Depth changes:
  - Label density: roughly 3, 6 and 10 labels.
  - Label naming: plain gloss, English anatomical term, or adds the Terminologia Anatomica Latin name in italic.
  - Margin notes (for example landmark distances with their disagreement, Davis types, ESGS codes) are collapsed at Essentials, available at Anatomy and open at Clinical.
  - Visibility of evidence marks.
- Nothing is hidden. Any note can be opened at any depth.

## 4. Experience model

- **Scroll = a precise timeline, never hijacked.**
  - Native scroll maps to `t`.
  - Each plate is a *plateau*: `t` holds constant while its text crosses the reading line (40% of viewport height).
  - The spacer after each plate is the transition.
  - The rendered state follows the target `t` with a critically damped spring.
  - **Long-jump rule:** a jump of more than about 1.5 plates (deep link, chapter nav, fast drag) dissolves directly to the destination instead of replaying the surgery. Reduced motion always uses this rule.
  - Scrolling backward restores the exact prior state, because the state is a pure function of `t`.
- **Deep links:** each plate has a `#plate-id` URL. Loading one evaluates that state directly, with no replay.
- **Navigation:**
  - A thin chapter rail shows chapter names and position. It acts as the navigation feedback that McKenna identified as what matters.
  - Keyboard: ←/→ or J/K move between plates. **Explicit** navigation (keys, rail, prev/next, deep link) moves focus to the destination plate heading. **Passive scrolling never moves keyboard focus.**
  - On-screen previous/next controls also exist for touch.
- **Instrument mode:**
  - Enter by dragging, or with a single control.
  - Constrained orbit and dolly.
  - The depth dial acts as a ghosting control per tissue family.
  - Tap or click a structure for its card: name at the current depth, what it does, and why it matters here.
  - User changes are an *override layer* on top of `evaluate(t)`. Scroll or plate change returns to the authored pose in about 400 ms.
  - Button alternatives for orbit and zoom (WCAG 2.5.7).
- **Orientation aids:**
  - The **orientation glyph**: a small line-drawn head showing view direction.
  - The **plane gauge**: a vertical tissue ruler from skin through fat, SMAS/fascia, superficial lobe, **nerve plane**, deep lobe and parapharyngeal space, marking the exposed plane.
  - Structures never vanish without explanation. They move to *ghost* or *hatched* mode, or visibly move away (retracted, lifted, removed). The text says which.
- **Labels:**
  - Margin columns with hairline leaders, sorted by screen y.
  - Greedy collision avoidance.
  - Occlusion tests against low-poly proxies.
  - Labels fade during transitions and re-lay out only at plateaus or when the instrument moves.
  - Label anchors are authored points baked into the glTF.
- **Deeper information:**
  - The **evidence drawer** opens from any claim mark or number.
  - The **structure card** opens from any label or pick.
  - Both are temporary side sheets that never cover the focus structure. The camera's safe rect makes room for them.

## 5. Visual system

- **Composition:**
  - Cameras are specified by **framing, not pose**: target structures, a view direction in the anatomical frame, and a *safe rect* per layout class. A solver sets distance and offset. View direction stays constant across aspect ratios, so orientation survives device changes.
  - **Landscape:** the scene takes the full viewport. The narrative column is narrow (a measure of about 34–40 em) in the negative space the camera leaves. Margin labels sit on the opposite side.
  - **Portrait:** the scene is sticky in the top ~58svh, with a label band of at most 4 labels beneath it and a single text lane below that. Margin notes become inline expanders.
  - Chrome should be under 10% of the viewport with the scene removed.
  - Chapters may change composition (a close dissection, a specimen inset, imaging-plane side-by-side) but keep the same grid logic.
- **Colour:**
  - **Field:** a near-neutral, very low-chroma drape tone (OKLCH L≈0.24–0.28, C≤0.02). It must not be black, cream or teal-glow.
  - In M1, A/B test it against neutral graphite using real tissue, and record the decision in an ADR.
  - **Tissue:** naturalistic, with restrained illustrator conventions: artery red, vein blue-grey, nerve ivory-yellow, gland lobulated salmon-tan, tumour grey-white.
  - **Attention:** comes from *context dimming* (context structures lose exposure and saturation) plus a thin non-emissive contour on the focus. Never neon recolouring.
  - **Gentian violet** is used only as matte ink on tissue: incision plan, resection margins, ESGS levels.
  - **UI chrome has no accent hue.** It relies on weight and luminance. Warnings and complications use a single desaturated ochre, shown only in the Complications chapter and the evidence drawer.
- **Typography** (all SIL Open Font License, self-hosted through Astro's Fonts API):
  - **Newsreader** (optical sizes): narrative text, and the Latin anatomical terms in italic.
  - **Atkinson Hyperlegible Next**: labels, UI, numbers. Its distinct letterforms help on mid-tone tissue. Tabular figures for measurements (verify `tnum`; if missing, use Source Sans 3 for numbers).
  - No monospace, no decorative eyebrows.
  - Labels are set at 500–600 weight, 12px or larger, on a soft scrim rather than a stroke.
- **Materials and lighting:**
  - Custom TSL node materials on a physical base:
    - clearcoat for wet surfaces;
    - sheen for fascia;
    - a thickness-driven wrap-SSS term for skin, gland and fat;
    - baked curvature and AO from Blender.
  - Three authored light presets:
    - **Studio**: soft key with rim for depth, used for anatomy chapters.
    - **Operative**: a cooler, overhead, surgical-light key with a tight falloff that lights the field and lets the surroundings fall off, but never below legibility.
    - **Specimen**: neutral and even.
  - A luminance rule: focus structures sit at least 15 L\* above the field.
  - Real-time GTAO provides contact depth. Depth of field is used sparingly, on desktop only, to separate foreground from context.
- **Motion:**
  - Every transition has one explanatory job, stated in its step spec. Staged sub-tracks run camera first, then reveal, never both at once for large moves.
  - No ambient motion and no entrance animations on UI.

## 6. Medical content model

- **Representative, not universal.** The operation chapter follows one representative sequence (Iowa protocol, cross-checked with StatPearls). The `Representative technique` and `Varies by surgeon` classes mark the steps that differ between institutions.
- **Variants shown as real branches on the same model:**
  - Incision: Blair vs facelift.
  - Resection: ECD, partial superficial, superficial, total or deep lobe.
  - Closure: no barrier, SMAS flap, SCM flap, or other barrier.
  - Chapter 6 ties each variant to the tumour characteristics that justify it. It never generalises small, mobile, superficial-tumour evidence to deep, recurrent or malignant disease.
- **Nerve anatomy shows variation.** The default branching is a common pattern. Davis/Katz variants can be shown, with pooled prevalence (Triantafyllou 2024) and the caveat that no classification fits well.
- **Numbers are "framed figures."** Each shows the value, the CI or range, n, the population, the study type, and a "why this may not apply to you" line. Example: transient facial weakness after superficial parotidectomy, pooled from mostly retrospective series of benign tumours.
- **Disagreement is shown, not resolved.** For example, the landmark distances from Witt, Rea and Pather appear as a range with each study's number. GAN numbness is 33.9% (Lambiel) vs 80–90% (StatPearls), with the definitions differing.
- **Retracted or weak sources** are blocked or flagged by the build validators (section 10).

## 7. Anatomy and asset strategy

**One body, one frame: the Visible Human male.** Every structure is registered to it.

| Layer | Source | Work |
|---|---|---|
| Skull, temporal bone, mastoid, mandible, auditory canal | TotalSegmentator on Visible Human normal CT (**canonical frame, ADR-0002**) | Remesh; refine the tympanomastoid suture and stylomastoid foramen from specs and landmark-registered cryosections. The styloid and zygomatic arch segment only as fragments, so they are authored |
| Parotid, submandibular gland | TotalSegmentator parotid and submandibular gland in the CT frame. The HRA parotid is a morphology reference only: it sits 12 mm from the CT frame (ADR-0002) | Split into superficial and deep lobes along an authored **nerve-plane surface**; add the accessory lobe and Stensen's duct |
| Masseter, SCM, IJV | TotalSegmentator | Remesh |
| Digastric (posterior belly), stylohyoid, ICA | **Authored** from specs. TotalSegmentator gives fragments or nothing on this non-contrast cadaver CT | Constrained by the mastoid, the segmented neighbours and cryosection tracing |
| Facial nerve (trunk, pes, divisions, 5 branch groups, posterior auricular, digastric twig), GAN, auriculotemporal nerve | **Authored**: `specs/nerves.yaml`, landmark-driven splines traced against cryosections, swept to true calibre | Every dimension cites its claim IDs |
| RMV, external jugular vein, ECA, superficial temporal, maxillary and transverse facial arteries | **Authored** from cryosection tracing plus the same spec approach | — |
| Skin, fat, SMAS/fascia, tragal cartilage, intraparotid nodes | **Authored** shells fitted between segmented surfaces | Flap-region patches for each incision variant |
| Face surface | **MPFB/MakeHuman base head (CC0 output)** fitted to the Visible Human skin and skull landmarks | The Visible Human face is a real, identifiable person, and the common "Lee Perry-Smith" scan is a real person too, so neither is used |
| Pleomorphic adenoma | Authored lobulated form, sized from literature, placed in the superficial lobe (level II) | The deep-lobe and dumbbell positions are alternate placements |

**Pipeline ("anatomy as code"):**
- `pipeline/sources/` holds manifests (URL, sha256, licence) for the raw data. The raw data itself is gitignored.
- `pipeline/segment/` runs TotalSegmentator in a **uv venv on Python 3.11/3.12**, because Python 3.14 may lack wheels.
- `pipeline/blender/` holds headless scripts pinned to **Blender 5.2**. They run: register → remesh or retopo → author from specs → split lobes → bake fields (peel order, ESGS level, lift vector, curvature, AO) → export glTF.
- `pipeline/build/` runs gltf-transform: meshopt, quantisation, KTX2 (UASTC for hero maps, ETC1S otherwise), sparse morphs, LODs, and per-chapter chunks.
- After clinical review, a correction means editing a spec and rebuilding.

**Licensing:**
- The sources (HRA, BodyParts3D if used, Visible Human attribution, TotalSegmentator citation, MPFB CC0) are all attribution-only.
- Z-Anatomy and every NC or ND source are excluded by default.
- A per-asset provenance record drives an auto-generated credits page.

**Downloads:** Visible Human CT and cryosection subsets, the HRA GLB, TotalSegmentator weights and MPFB require downloads. Each is confirmed at the time it is needed.

## 8. Technical architecture

**Chosen stack.** The renderer choice is **provisional until the M0 renderer spike (section 0) passes**. three.js still labels `WebGPURenderer` experimental, and WebGPU is not yet Baseline in every major browser.
- **Site:** Astro 6 with MDX content collections, static output.
  - Every plate's text, scene description, and evidence are server-rendered HTML, so they work without JavaScript or WebGL.
- **Scene:** one **vanilla TypeScript three.js island**, pinned to r186, using `WebGPURenderer` with automatic WebGL2 fallback.
  - React/R3F is not used, because v10 is still alpha and a reconciler adds nothing to an imperative, timeline-driven scene.
  - Babylon.js was considered for its built-in SSS. It was rejected because that SSS runs only on WebGL2 and is heavy, and three.js fits better with DOM-led scrollytelling.
- **Timeline:** custom, with no GSAP, Lenis or smooth-scroll library.
- **Validation:** zod schemas shared across the content collections, the pipeline and the validators.
- **Tests:** Vitest for the timeline; Playwright for capture and visual regression.

**Repository layout (npm workspaces):**
```
apps/site/            Astro; src/content/{chapters,steps,claims,sources,structures,assets,glossary}
packages/schema/      zod schemas (single source of truth)
packages/timeline/    pure TS: SceneState, compile(steps)→Track, evaluate(track,t), resolve(semantic)→RenderState
packages/stage/       three.js: renderer, TSL materials, loader/streaming, director, labels, picking, tiers, dev console
pipeline/             specs/, sources/, segment/, blender/, build/
tools/capture/        Playwright plate capture → static fallbacks and regression baselines
tools/validate/       claims, sources (retraction blocklist), numbers carry population, provenance, structure↔glTF node ids
docs/adr/             decision records; CLAUDE.md for agent conventions
```

**Core interfaces:**
- **`SceneState`** (semantic, authored as per-plate *deltas* in step frontmatter) contains:
  - `camera`: frame targets, azimuth and elevation in the anatomical frame, safe rects.
  - `structures[id]`: presence 0..1, mode (solid, ghost, hash, illustrative), emphasis (focus, context, dim), clip.
  - `gauge`.
  - `op`: incision variant, ink paths, incision, flap, SMAS flap, resection {variant, levels, progress}, nerve mobilisation, specimen, closure, healing, drain.
  - `insets`, `labels`, `light` (preset, exposure).
- **Pipeline stages:**
  - `compile` turns the deltas into absolute keyframes, which is what makes deep links exact.
  - `evaluate` is pure. It interpolates continuous fields, crossfades enums, and interpolates camera *framing parameters*, not positions.
  - `resolve` maps semantic state to morph weights, bones and uniforms, so content authors never touch rendering detail.
- **Director:** owns the target `t` and the spring, the long-jump dissolve, instrument overrides, `plate-settled` events (fired once the spring has come to rest on a plateau, never during continuous scrub; they drive the live region, plus focus only when the navigation was explicit) and the `aria-label` on the canvas.
- **Dev-only director's console:** scrub `t`, edit a plate's delta live, copy the result back as YAML. It is essential for authoring 60+ plates.

**How each operative transformation is implemented:**

| Transformation | Approach |
|---|---|
| Incision | A separate skin patch per variant, stitched to the face along a real seam. A per-vertex path parameter drives the ink line and the cut progress. A small morph opens the wound edge. |
| Skin flap | A skinned 4–6-bone hinge chain plus a corrective morph. A modelled cut-edge rim. The underside renders as fat through `frontFacing`. Retractors are rigid props parented to the bones. |
| Superficial lobe dissection | A vertex-shader **peel driven by baked fields**, with the fold hinge on the lobe's lateral surface at the dissection front (the M0 spike showed a deep-face hinge self-intersects). The per-vertex attribute `d` is the distance from the trunk along the branches, which gives antegrade order. The lobe lifts anteriorly off the nerve as `progress` passes `d`. The exposed deep surface renders as cut parenchyma. It is continuous, exactly scrubbable, and never hollow. |
| Partial superficial | The same peel, gated by the baked ESGS level attribute. |
| ECD | The same shader with a different field: distance from the tumour surface, with a cuff uniform. The branches are deliberately **not** exposed; that is the lesson. |
| Total / deep lobe | A nerve-mobilisation morph plus a second peel field for the deep lobe, labelled schematic. |
| Specimen | A rigid move out of the field → the pathology inset. |
| Closure, post-op | Bones return, suture and drain props, optional barrier sheet, a preauricular hollow morph (needs a source) and a scar mask driven by `healing`. |

**Clipping:** one custom clip uniform inside our own node materials. Caps come from `frontFacing`, which avoids depending on `ClippingGroup` or `material.clippingPlanes`.

**Transparency:** follows anatomical nesting render order. Ghost mode uses a **single-layer blend**: a depth-only twin draws first, then the tissue blends over the opaque interior. The M0 spike rejected alpha-hash plus TRAA because of residual stipple (ADR-0001). The three.js OIT pass node will be evaluated later, not relied on.

## 9. Performance and accessibility

**Quality tiers** (auto-selected from adapter detection plus a 2-second warm-up benchmark, with automatic step-down on p95 frame time; the user can override):

| Tier | Renderer | Features | Target |
|---|---|---|---|
| High | WebGPU | GTAO, DOF, TRAA, 2K hero textures, ≤2.5M triangles | RTX 3070 at 1440p: 60 fps median |
| Mid | WebGL2 or WebGPU | 1K textures, no AO, FXAA, ≤1M triangles | Iris Xe laptop, iPhone 13, Pixel 7 class: ≥30 fps |
| Static | none | captured plates with the same text, labels and evidence | no WebGL, reduced data, print |

**Budgets:**
- First plate interactive in under 3 s on 50 Mbps.
- Initial payload ≤8 MB.
- Chapters stream ahead of the reader.
- The M1 slice totals ≤25 MB.
- GPU memory ≤300 MB on mobile, to avoid iOS tab kills.

**Accessibility:**
- **The semantic DOM is the principal assistive-technology path.** Each plate is an `<article>` with a heading, its body, its `sceneDescription` and its static figure (the captured plate plus alt text), in reading order. The 3D canvas is an enhancement layered over that document, never the only carrier of the lesson.
- **Keyboard:** full traversal. Plates are headings in DOM order. Passive scrolling never moves focus; explicit navigation moves focus to the destination heading.
- **Screen readers:** the canvas has `role="img"` with a per-plate `aria-label`. Each plate has an authored `sceneDescription` (what is visible, cut, retracted or at risk). It is announced once through a polite live region **only when a plate has settled**, never on intermediate scrub states. Repeat announcements of the same plate are suppressed.
- **Motion:** `prefers-reduced-motion` and an in-page toggle both switch transitions to dissolves between plates. No flashing content.
- **Labels:** real text. Text contrast ≥4.5:1 against sampled local background; leader lines ≥3:1.
- **No-WebGL path:** the Static tier keeps the whole conceptual lesson.

## 10. Evidence architecture

- **Claim** (content collection):
  - text per depth;
  - `evidenceClass`: Established anatomy / Standard surgical principle / Representative technique / Varies by surgeon or institution / Comparative evidence / Uncertain or evolving;
  - sources, each with a locator (table, figure or page) and whether it supports the claim directly or indirectly;
  - `numbers[]` {value, CI, n, population, design};
  - limitations and disagreement;
  - `lastChecked` and `clinicalReview` status.
- **Source:** citation, PMID/DOI, publication type, year, `checkedDate`, `retracted`.
- **Structure:** a stable id matching its glTF node, TA2 and FMA ids, plain name, gloss, tissue family, `depthIndex`, anchors.
- **Asset:** source, licence, attribution, sha256, list of transformations, and the claims behind its spec.
- **How evidence appears in text:**
  - Every substantive sentence resolves to a claim, through inline `<Claim id>` tags in the MDX.
  - Visual encoding stays quiet:
    - Each paragraph ends with a small source affordance.
    - Only claims that change interpretation get a visible dotted underline: *varies by surgeon* and *uncertain*.
    - At Clinical depth, every claim shows a hairline mark.
  - The drawer shows the claim's source, publication type, the exact figure with its population, limitations and any disagreement.
- **Validators fail the build** on:
  - text with no claim;
  - a number with no population;
  - a retracted or blocked source (Barrameda 2026 on day 1);
  - an asset with no provenance;
  - a structure id with no matching glTF node.
- **Review packet** (because clinical review happens after implementation), generated automatically:
  - every plate capture;
  - its claims and sources;
  - the anatomy spec values with their cited ranges;
  - a checklist.
  - The reviewer's corrections go into claim, spec and step files. `clinicalReview` status gates the public build.

## 11. Milestones

| # | Milestone | Demonstrable end state |
|---|---|---|
| **Gate** | Bootstrap (section 0) | Minimal repo builds, tests, validates and runs; plan and state persisted; clean commit. **Stop for the user.** |
| **M0** | Foundations and de-risking | Real schemas and validators; the corrected bibliography entered as sources. **Renderer feasibility spike passes on WebGPU and forced WebGL2 → stack locked in ADR-0001.** Registration spike passes (HRA and TotalSegmentator mandibles under 2 mm; parotid over cryosections). |
| **M1** | **Vertical slice** | Ten plates of real anatomy, from face to a partial peel (section 12), at full quality bar, with every system present in minimal form. |
| **M2** | Anatomy, pathology and diagnosis | Chapters 1–5 complete: pseudocapsule inset, registered imaging planes, Milan categories, variant nerve patterns, all three depths, full evidence drawer. |
| **M3** | The operation | Chapters 6–8: ESGS painting and decision logic, all four resection variants, specimen and pathology, closure variants, the facelift incision variant. |
| **M4** | Afterwards, complications and explore | Chapters 9–11: postoperative state and healing, the complication-to-structure mapping, the free explorer and the procedure comparison. |
| **M5** | Hardening and review | Accessibility audit, all fallbacks, performance on the device matrix, credits and provenance page, **clinical review cycle**, a lay comprehension study, and content freeze before public launch. |

## 12. First vertical slice (M1)

**Ten plates:**
1. **Face**: right lateral view, lump suggested, orientation glyph introduced.
2. **Where the parotid is**: skin ghosts; the gland is in focus against ear, jaw and masseter context.
3. **Layers**: a gauge-driven cutaway window through skin → fat → SMAS/fascia → gland.
4. **The tumour**: pleomorphic adenoma in the superficial lobe, at true scale.
5. **The nerve within**: the gland is hatched; the nerve emerges from the stylomastoid foramen → pes → five branch groups, at true calibre.
6. **The nerve plane**: the plane divides the gland; the gauge marks it; the tumour sits lateral to it.
7. **Incision planned**: modified Blair incision drawn in marker ink.
8. **Flap raised**: the GAN and SCM are shown; the flap sits in the plane above the fascia.
9. **Finding the trunk**: the tragal pointer, tympanomastoid suture and digastric converge. The measured distances appear with their disagreement.
10. **The peel**: the superficial lobe lifts off the pes and upper division to about 60%, and the tumour lifts with it.

**Included systems** (minimal but real): depth toggle, evidence drawer, labels, portrait layout, reduced motion, static fallbacks, director's console, tier manager.

**Must be real:**
- HRA parotid split by the authored nerve plane.
- The segmented bones and muscles listed in section 7.
- The spec-authored facial nerve, RMV, ECA course and GAN.
- The fitted face with its flap patch.
- The pleomorphic adenoma.
- Look-development-quality materials for skin, gland, nerve and tumour.

**May be placeholder:** secondary textures, deep-lobe detail, parapharyngeal space, auriculotemporal nerve, nodes, accessory lobe and duct, the facelift variant, Cycles hero renders.

## 13. Principal risks and early tests

1. **Registration across sources: resolved in M0 (ADR-0002).**
   - The HRA-vs-CT mandible fit was 5.7 mm, failing the 2 mm criterion.
   - The cryosections differ from the CT in posture, non-rigidly.
   - Resolution: the CT is the canonical frame; the HRA is reference only; cryosections get local landmark registration in M1.
2. **Authored nerve and vessel accuracy with no reviewer until the end.**
   - Every spec value carries its cited range. A validator checks model distances against those ranges.
   - **Topology and relationship checks, not only scalar distances** (`tools/validate` plus pipeline assertions). Examples:
     - the trunk exits the stylomastoid foramen, and every branch descends from it;
     - the pes lies lateral to the retromandibular vein and external carotid in the default pattern;
     - branch order is temporal → zygomatic → buccal → marginal mandibular → cervical, from superior to inferior;
     - the marginal mandibular branch runs near the lower border of the mandible;
     - the nerve lies in the plane that separates the superficial and deep lobes;
     - no nerve or vessel tube intersects bone;
     - the graph is connected, and loops are allowed only where a named interconnection exists.
   - **Visual QC of surgically important segmentations and authored geometry** against source anatomy: the parotid, digastric, SCM, mandible, mastoid/styloid, facial nerve, RMV and ECA. Overlays on Visible Human cryosections and CT at fixed levels, plus orthographic contact sheets, are generated by the pipeline and kept in the review packet. A QC log records who checked what, and when.
   - Keep the review packet current from M1 onward, so late review is a data edit, not a rebuild.
3. **Plastic tissue, or darkness hiding anatomy.**
   - A look-development board comparing real-time WebGPU renders with Cycles references under the same light presets.
   - A luminance-rule check.
   - The field A/B test.
4. **Renderer maturity.** `WebGPURenderer` is experimental. Nested-transparency shimmer, peel determinism, clip caps, TSL materials, post-processing and WebGL2 fallback parity are all proved together in the **M0 renderer spike** (section 0), before any scene code depends on them. Fallback: the dithered illustrative ghost mode.
5. **Plausibility of the peel on real anatomy.** The M0 spike proves the mechanism. M1 plate 10 proves the look on the real split lobe.
6. **Mobile and WebGPU variance.**
   - Forced-WebGL2 and throttled Mid tests are part of the M0 spike.
   - In M1, test Firefox, and Safari 26 on real hardware if available.
7. **Authoring throughput.**
   - The director's console is part of M1, not a later addition.
8. **Licence contamination.**
   - The provenance validator.
   - Default exclusion of share-alike, NC and ND sources.

## 14. Acceptance criteria (M1)

- **Determinism:** all ten plates are deep-linkable. Plateau frames differ by less than 0.5% of pixels across forward scrub, backward scrub and cold load (Playwright).
- **Performance:**
  - RTX 3070 at 1440p, High tier: ≥60 fps median, p95 <20 ms.
  - Mid tier (WebGL2, throttled): ≥30 fps.
  - Initial payload ≤8 MB; slice ≤25 MB; first plate interactive in under 3 s on 50 Mbps.
- **Anatomy:**
  - The nerve is at true calibre. Emphasis comes only from contour and context dimming.
  - Every modelled landmark distance falls inside its cited range (validator).
  - All topology and relationship assertions pass (section 13, risk 2).
  - Visual QC overlays exist and are signed off in the QC log for every surgically important segmentation and authored structure.
  - Nothing obviously wrong against the Netter-style references (self-review checklist in the review packet).
- **Orientation:** the anatomical view direction is unchanged across all ten plates except for authored, explained moves. No structure disappears without a visible change of mode or position plus explaining text.
- **Labels:**
  - No overlaps and no labels on occluded structures.
  - Text contrast ≥4.5:1; leader lines ≥3:1.
  - At most 6 labels in landscape and 4 in portrait.
- **Accessibility:**
  - Full keyboard traversal.
  - Passive scrolling never moves focus (Playwright asserts `document.activeElement` is unchanged across a wheel scrub). Explicit navigation lands focus on the destination heading.
  - The live region announces each settled plate exactly once and stays silent during continuous scrub (Playwright records live-region mutations).
  - The semantic DOM alone (canvas hidden) carries every plate's title, body, `sceneDescription` and static figure in reading order.
  - Reduced motion uses dissolves only.
  - Static fallbacks are generated for every plate, and the lesson holds with WebGL disabled.
- **Evidence:** all validators pass. Every substantive sentence resolves to a claim. Every number carries its population.
- **Design:**
  - Chrome is under 10% of the viewport.
  - An audit against the brief's avoid-list passes.
  - Violet appears only as ink in the scene.
  - The field-colour ADR is decided.
  - The owner can answer the brief's validation questions from the slice alone: where is the parotid, why the nerve matters, and where the tumour is relative to the nerve.

## Verification (how the implementation is checked end to end)

- Run `npm run validate`, the Vitest timeline tests (evaluate purity, compile deltas, long-jump rule) and the Playwright capture suite (plate determinism, visual regression, contrast sampling, label overlap) in CI on every change.
- Launch the site through `.claude/launch.json` (Astro dev server). Drive it in the built-in browser pane:
  - scrub forward and backward;
  - deep-link each plate;
  - toggle depth, reduced motion and the forced WebGL2 tier;
  - read the accessibility tree;
  - check that passive scrolling leaves focus alone and that only settled plates are announced.
- Run the performance harness: `renderer.info` plus the frame-time recorder on High and Mid tiers, and the payload report from the build.
- Pipeline checks:
  - the registration report (surface distances);
  - the spec-range report;
  - the topology and relationship report;
  - visual QC overlays of segmented and authored structures on cryosections and CT, and orthographic contact sheets, logged in the QC log.
- **Order of execution:**
  - the bootstrap gate, then stop;
  - after the user resumes, M0: the renderer spike and the registration spike, run in parallel before any scene code;
  - then M1.
