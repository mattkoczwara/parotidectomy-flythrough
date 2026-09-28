# Planning Directive — Interactive Parotid Surgery Atlas

<role>
Act as the product architect, creative director, scientific-visualization designer, interaction designer, medical-information architect, and lead technical planner for this project.

Your task in this phase is to determine the strongest coherent product and implementation plan before substantial implementation begins.

You have broad decision authority.

Do not merely translate the requirements below into a checklist. Interpret them, identify the underlying design problem, investigate the repository and research material, resolve important tradeoffs, and propose the approach that best serves the ultimate product.

Do not assume a particular framework, renderer, animation system, layout system, asset pipeline, or visual style unless the evidence and product requirements justify it.
</role>

<mission>
Design and plan a public interactive website that explains parotid tumors and parotid surgery—principally using pleomorphic adenoma and representative parotidectomy techniques as the educational pathway.

Its defining feature is a high-fidelity anatomical experience in which scrolling and direct interaction progressively reveal anatomy, pathology, diagnostic concepts, surgical exposure, facial-nerve relationships, tumor removal, closure, recovery, and relevant complications.

The visualization is not supplementary decoration.

The visualization is the primary explanatory medium.

The intended result should be understandable to a prospective patient or family member, genuinely useful to a medical student, and sufficiently rigorous that a clinician can explore it without immediately finding the anatomy or procedural explanation superficial.

This is a general educational atlas, not a reconstruction of one patient's surgery and not a substitute for an individual's surgeon.
</mission>

<first_principles>
Approach the product from first principles rather than beginning with conventional website patterns.

Ask:

- What does the viewer actually need to understand at this moment?
- Which spatial relationship is difficult to understand through text alone?
- What should remain visually stable so the viewer does not lose orientation?
- What should change?
- What deserves the viewer's attention first?
- Which information is essential now versus useful only on demand?
- Is a piece of UI improving comprehension or merely decorating the page?
- Is motion teaching something or simply making the interface move?
- Would this concept still be compelling if all fashionable web styling were removed?
- Is the experience exploiting the unique explanatory power of interactive 3D rather than imitating video, slides, or a textbook?

Design outward from those questions.
</first_principles>

<design_thesis>
The anatomy should be the dominant visual object and the organizing structure of the experience.

Treat the interface almost as an instrument surrounding the anatomical scene.

The product should derive its identity from:
- anatomical form;
- depth;
- scale;
- tissue relationships;
- operative transformation;
- carefully controlled lighting;
- motion through anatomical space;
- typography;
- annotation;
- scientific precision.

Do not derive its identity primarily from:
- decorative containers;
- conventional marketing layouts;
- dashboard components;
- trendy web effects;
- ornamental gradients;
- arbitrary branding devices.

The experience should feel authored specifically for surgical anatomy.

If the interface could be reused with minimal change for an AI startup, investment dashboard, architecture portfolio, or luxury-product page, the visual language is insufficiently specific to the subject.
</design_thesis>

<desired_character>
Seek a visual experience that is:

- striking without being theatrical;
- sophisticated without being ornate;
- clinically precise without feeling sterile;
- immersive without becoming game-like;
- information-dense when useful without appearing cluttered;
- quiet when the anatomy needs attention;
- dramatic when scale, depth, or anatomical revelation warrants it;
- highly legible;
- spatially coherent;
- contemporary without depending on current design trends.

The user should remember the anatomy and what happened during the procedure more strongly than they remember the website chrome.
</desired_character>

<avoid_default_opus_design>
Claude Opus 5.5 has known frontend design defaults. Actively avoid falling into them.

Do not solve this project with a generic AI-generated website aesthetic.

Unless there is a compelling subject-specific reason, avoid:

- cream/off-white editorial backgrounds as the primary identity;
- purple-on-white or blue-purple gradient branding;
- giant marketing hero copy followed by conventional content sections;
- a dashboard composed of repeated rounded cards;
- glassmorphism as a general interface language;
- excessive border-radius on every container and control;
- pill-shaped buttons everywhere;
- numbered "01 / 02 / 03" section labels as decoration;
- tiny uppercase or monospace eyebrow labels used indiscriminately;
- gratuitous monospace typography to imply technical sophistication;
- italicized accent words inside oversized headlines;
- predictable alternating left-text/right-image sections;
- feature grids;
- generic bento grids;
- decorative statistic cards;
- floating translucent panels covering large portions of the primary visual;
- neon medical or sci-fi styling;
- excessive glows;
- ambient gradient blobs;
- ubiquitous icon-plus-title-plus-description components;
- over-animation of minor interface elements;
- motion applied simply because animation is available;
- turning every piece of information into its own card;
- decorative medical crosses, ECG traces, DNA imagery, molecules, or other generic healthcare symbolism unrelated to this operation.

Do not simply substitute another stock aesthetic for these.

Develop a design language that emerges from this specific anatomical and educational problem.
</avoid_default_opus_design>

<visual_hierarchy>
Design each moment around a clear hierarchy of attention.

At any important point in the narrative, it should be obvious:
1. what anatomical structure or surgical action is primary;
2. what contextual anatomy establishes orientation;
3. what explanatory text matters now;
4. what additional detail is available if requested.

Avoid presenting anatomy, prose, citations, controls, navigation, labels, and secondary facts with equal visual weight.

Use progressive disclosure aggressively where appropriate.

Information may be deep without being simultaneously visible.
</visual_hierarchy>

<information_architecture>
Do not treat the website as a sequence of ordinary webpage sections.

Develop an information architecture appropriate to a continuous anatomical narrative.

Determine how best to combine:
- guided storytelling;
- spatial orientation;
- user-controlled exploration;
- chapter navigation;
- surgical progression;
- anatomical labels;
- contextual explanation;
- definitions;
- advanced technical information;
- evidence/citations;
- procedure variants.

The user should rarely need to choose between reading and watching.

Whenever practical, text and visualization should explain the same moment together.

Avoid large detached blocks of prose explaining something the user can no longer see.

Use concise primary explanation and make deeper material available contextually.

Consider whether the experience should operate at several explanatory depths—for example patient, learner, and advanced/clinical—without creating separate products.

Determine the best solution.
</information_architecture>

<composition>
Think cinematically about composition but interactively about control.

The anatomical scene may occupy most of the viewport when that improves understanding.

Text does not always need its own large rectangular column.

Explore composition methods such as:
- marginal annotation;
- anchored labels;
- restrained text overlays;
- contextual side notes;
- dynamic callouts;
- negative space intentionally created by camera composition;
- temporary explanatory panels;
- direct annotation of structures;
- selective expansion for deeper information.

Do not make the anatomy fight with persistent UI.

Allow compositions to change meaningfully between moments if the narrative benefits from it.

A close anatomical dissection does not necessarily require the same composition as an introductory external view or a pathology explanation.

Maintain overall coherence without requiring every chapter to use the same template.
</composition>

<typography>
Treat typography as part of the scientific interface.

Choose a typographic system based on:
- excellent legibility;
- clear distinction between narrative explanation, anatomical terminology, labels, measurements, and references;
- strong behavior over complex 3D backgrounds;
- an authoritative but humane character.

Do not automatically choose Inter, Arial, Roboto, generic system UI, Space Grotesk, or a fashionable display font merely because they are common in generated interfaces.

Do not seek novelty for its own sake.

Select typography because it complements anatomical imagery and efficiently communicates dense technical information.

Typography should contribute genuine visual identity without competing with the subject matter.
</typography>

<color>
Develop a semantic color system instead of a decorative palette.

Color should primarily help distinguish anatomy, establish hierarchy, communicate state, and direct attention.

Consider:
- tissue families;
- nerves;
- vessels;
- tumor/pathology;
- active surgical region;
- currently discussed structure;
- structures intentionally de-emphasized;
- warnings or complication states.

Do not allow educational coloring to turn realistic anatomy into a plastic multicolor model.

Determine how naturalistic material appearance and selective semantic highlighting can coexist.

The surrounding interface should support this anatomical color system instead of competing with it.
</color>

<depth_and_lighting>
Lighting and depth are explanatory tools.

Use them to communicate:
- anatomical volume;
- tissue boundaries;
- separation between planes;
- depth of the surgical field;
- the position of a tumor relative to the facial nerve;
- the difference between foreground anatomy and contextual anatomy.

The lighting should be carefully authored rather than merely technically correct.

Avoid either extreme:
- flat textbook rendering that destroys depth;
- cinematic darkness that obscures medically relevant structures.

Determine an appropriate visual exposure and rendering character for each context while maintaining continuity.
</depth_and_lighting>

<motion>
Every important animation should have an explanatory purpose.

Motion can communicate:
- layer relationships;
- camera orientation;
- incision and exposure;
- retraction;
- separation of tissue planes;
- nerve branching;
- tumor location;
- surgical progression;
- removal;
- postoperative change;
- transition between gross anatomy, imaging, and microscopic explanation.

Prefer a few highly composed transformations over constant ambient movement and miscellaneous micro-interactions.

Scroll should behave like a precise timeline or spatial controller rather than merely triggering entrance animations.

Scrolling backward should restore prior explanatory states coherently.

Avoid scroll-jacking that makes the user feel they have lost control.

Determine the appropriate balance between continuous scrubbing, discrete states, interpolation, and intentional pauses.
</motion>

<spatial_continuity>
Protect the viewer's mental map.

A common failure in medical visualization is technically impressive animation that repeatedly changes orientation until the viewer no longer knows where structures are.

Establish anatomical orientation early.

When moving the camera significantly:
- provide visual continuity;
- preserve recognizable landmarks where possible;
- communicate why the viewpoint changed;
- avoid unnecessary rotations.

Use transitions, transparency, exploded views, cutaways, clipping, and retraction in ways that preserve spatial context.

Structures should not simply vanish because they are inconvenient.

The viewer should understand what moved, what was removed, what became transparent, and what remains.
</spatial_continuity>

<medical_storytelling>
The sequence should build a mental model rather than merely enumerate facts.

The viewer likely needs to understand normal anatomy before pathology and pathology before surgical technique.

However, do not assume a rigid chapter structure from this prompt.

Determine the most effective narrative.

The experience should ultimately convey:
- normal parotid anatomy;
- facial-nerve anatomy;
- representative tumor positions;
- pleomorphic adenoma;
- diagnostic evaluation;
- how tumor characteristics influence operative planning;
- exposure;
- relevant tissue planes and landmarks;
- facial-nerve identification and preservation;
- representative dissection;
- removal of tumor-bearing tissue;
- differences among major parotid procedure concepts;
- specimen/pathology;
- closure;
- postoperative anatomy;
- healing;
- important complications.

Use the 3D representation to explain concepts that are otherwise difficult to picture.
</medical_storytelling>

<multi_level_explanation>
The same scene should support different levels of expertise.

Determine the strongest interaction model for this.

For a patient, prioritize:
- orientation;
- plain but accurate language;
- why something matters;
- what they may experience.

For a learner, expose:
- anatomical terminology;
- surgical landmarks;
- procedural sequence;
- deeper mechanisms.

For advanced users, make available:
- technical nuance;
- recognized variations;
- evidence;
- citations;
- limitations.

Avoid simply tripling the amount of visible text.

Depth should be revealed intelligently.
</multi_level_explanation>

<evidence_design>
Evidence should be structurally integrated into the product without making the primary experience resemble a research paper.

Every substantive medical claim must remain traceable.

Design a citation/evidence interaction that allows users to inspect:
- source;
- publication type;
- relevant claim;
- evidence limitations;
- disagreement where applicable.

Numerical risks require especially clear sourcing and population context.

Distinguish:
- well-established anatomy;
- common surgical principle;
- one representative technique;
- surgeon/institution variation;
- evidence-supported comparative claim;
- uncertain or evolving evidence.

The visual design should communicate these differences without constantly interrupting the narrative.
</evidence_design>

<medical_integrity>
Medical accuracy outranks visual drama.

Do not visually imply certainty unsupported by evidence.

Do not portray one institution's operative sequence as the universal parotidectomy.

Do not imply that all pleomorphic adenomas require identical surgery.

Do not turn the facial nerve into an oversized glowing cable merely for visibility without clearly preserving true scale/context.

Do not fabricate patient imaging.

Do not depict simplified conceptual pathology as though it were an exact microscopic representation of every tumor.

Whenever educational simplification is necessary, preserve the relevant anatomical or clinical truth.
</medical_integrity>

<research>
Use the supplied project research-reference markdown as a starting evidence base.

Expand it where required.

During planning, specifically investigate:
- high-quality parotid/facial-nerve anatomical references;
- representative operative approaches;
- modern management of pleomorphic adenoma;
- meaningful procedure variants;
- current complication/outcome evidence;
- nerve-monitoring evidence;
- postoperative anatomy and healing;
- legally usable anatomical geometry/data;
- medical visualization precedents;
- interaction approaches appropriate to complex spatial education.

Prefer primary literature, systematic reviews, academic surgical protocols, major medical references, and legitimate open anatomical datasets.

Track uncertainty rather than resolving disagreements by intuition.
</research>

<asset_and_geometry_strategy>
Treat anatomical geometry as a first-order product risk.

Investigate what high-quality, legally usable source anatomy exists and whether it is sufficient for this operation.

Evaluate:
- anatomical completeness;
- head/neck accuracy;
- facial-nerve detail;
- parotid geometry;
- tissue layers;
- topology;
- animation suitability;
- material suitability;
- licensing;
- ability to modify;
- web performance.

Determine whether the best result requires:
- licensed/open existing meshes;
- reconstruction from reference datasets;
- original modeling;
- procedural augmentation;
- manual retopology;
- hybrid techniques.

Do not plan the entire experience around low-quality readily available geometry simply because it is convenient.

Identify missing anatomy early.
</asset_and_geometry_strategy>

<technical_strategy>
Choose technology only after understanding the experience.

Evaluate candidate approaches against:
- graphical fidelity;
- deterministic scroll control;
- anatomical transparency/cutaway requirements;
- animation requirements;
- material quality;
- clipping/sectioning;
- labeling;
- asset streaming;
- desktop performance;
- mobile degradation;
- browser compatibility;
- accessibility;
- maintainability;
- development velocity.

Do not optimize for technological novelty.

Do not default to a familiar library without comparing it to the actual requirements.

Use whatever stack provides the strongest practical result.

Record consequential choices and why they were made.
</technical_strategy>

<performance>
Treat performance as part of visual design.

Define realistic performance and asset budgets after selecting the technical strategy.

Determine:
- target desktop class;
- acceptable lower-end behavior;
- mobile strategy;
- progressive loading;
- texture strategy;
- geometry strategy;
- LOD or alternative representations;
- quality scaling;
- GPU memory considerations;
- fallback behavior.

The high-quality master experience should not be reduced to the lowest common denominator.

Instead, create deliberate quality tiers or graceful degradation where appropriate.
</performance>

<accessibility>
Do not make accessibility an afterthought.

The experience must remain usable without:
- a mouse wheel;
- precise pointer control;
- full motion;
- high-performance 3D hardware.

Plan appropriate equivalents for:
- keyboard;
- touch;
- reduced motion;
- assistive technology;
- fallback explanatory content.

Accessibility should preserve the conceptual lesson, not merely expose navigation controls.
</accessibility>

<planning_method>
Begin by inspecting:
1. the repository;
2. existing assets;
3. project documentation;
4. the supplied medical research references;
5. available development and browser/visual-inspection tools.

Research unresolved high-risk areas before committing to architecture.

Use subagents selectively where independent investigation benefits from parallelism or isolated context—for example:
- medical evidence review;
- anatomy/asset feasibility;
- technical rendering evaluation;
- interaction/design precedent review.

Do not delegate merely to create activity.

Synthesize findings yourself into one coherent product direction.

Do not expose or reproduce private chain-of-thought. Produce concise decisions, evidence, tradeoffs, and rationale.
</planning_method>

<design_exploration>
Do not converge immediately on the first plausible design.

Before selecting the direction, explore materially different high-level compositions and interaction philosophies.

These should differ in underlying product logic, not merely color palette.

Evaluate them against:
- anatomical comprehension;
- visual distinction;
- medical credibility;
- information efficiency;
- interaction clarity;
- scalability across the full surgical story;
- accessibility;
- technical feasibility.

Select or synthesize the strongest direction.

Do not present a large menu of superficial concepts and ask the user to design the product for you.

Own the recommendation.
</design_exploration>

<validation_philosophy>
The design is successful only if it improves understanding.

Plan validation around questions such as:

Can a new viewer accurately locate the parotid afterward?

Can they explain why the facial nerve makes this operation technically sensitive?

Can they distinguish tumor, gland, nerve, and surrounding structures spatially?

Can they understand what changes between different extents of parotid surgery?

Can they follow the operative transformation without losing orientation?

Can they understand the essential content without reading every advanced annotation?

Can an advanced user expose greater detail without overwhelming the patient-level experience?

Does the interface recede when the anatomy needs attention?

Does the page look unmistakably designed for this particular subject?

Would a clinician recognize obvious anatomical or procedural mistakes?

Can a user scrub backward and still understand the state?

Does the experience remain educational in reduced-motion or simplified-rendering modes?
</validation_philosophy>

<early_proof>
Identify the smallest coherent vertical slice capable of proving the project's hardest assumptions.

It should be substantial enough to validate:
- the visual language;
- anatomical fidelity;
- spatial storytelling;
- scroll interaction;
- text/visual integration;
- labeling;
- lighting/material treatment;
- rendering performance.

A likely candidate is some variation of:
external orientation -> tissue/anatomy reveal -> parotid localization -> tumor relationship -> facial-nerve reveal -> transition toward operative anatomy.

This is a hypothesis, not an instruction.

If research identifies a better proof, choose it.

Do not use a trivial spinning model as the proof of concept.
</early_proof>

<planning_output>
Produce one integrated implementation plan.

Keep it detailed enough to guide sustained implementation but concise enough that the important decisions remain visible.

Include:

1. PRODUCT INTERPRETATION
What the experience fundamentally is and what it is not.

2. DESIGN DIRECTION
The chosen visual and interaction philosophy and why it fits the subject.

3. INFORMATION ARCHITECTURE
How the educational story is organized and how different knowledge levels coexist.

4. EXPERIENCE MODEL
How scrolling, exploration, camera behavior, annotation, navigation, and deeper information work together.

5. VISUAL SYSTEM
High-level direction for composition, typography, color semantics, materials, lighting, depth, and motion.

6. MEDICAL CONTENT MODEL
The representative narrative, meaningful procedure variants, and how uncertainty is represented.

7. ANATOMY / ASSET STRATEGY
What geometry is required, likely sources, licensing considerations, gaps, and proposed asset workflow.

8. TECHNICAL ARCHITECTURE
The recommended technologies and architecture selected after evaluating alternatives.

9. PERFORMANCE / ACCESSIBILITY STRATEGY
Target experience, degradation strategy, and principal budgets/constraints.

10. EVIDENCE ARCHITECTURE
How medical sources, claims, citations, uncertainty, and asset provenance are stored and surfaced.

11. MILESTONES
A small number of coherent implementation phases, each ending in a meaningful demonstrable product state.

12. FIRST VERTICAL SLICE
Precisely what should be built first to establish the quality bar.

13. PRINCIPAL RISKS
The handful of things most likely to prevent the project from reaching the desired standard and how to test them early.

14. ACCEPTANCE CRITERIA
Observable criteria for determining whether the first major implementation milestone actually meets the intended standard.

Avoid low-value implementation trivia unless it materially affects architecture or quality.
</planning_output>

<decision_authority>
Make reasonable product, design, research, and technical decisions yourself.

Do not ask the user to choose:
- libraries;
- minor visual styles;
- routine architectural details;
- common implementation approaches;
- trivial asset decisions.

Ask only when a decision:
- materially changes the product's purpose;
- creates significant cost;
- introduces a licensing restriction;
- requires credentials or unavailable assets;
- is destructive or hard to reverse;
- cannot responsibly be inferred from the stated goals.

Otherwise choose, document the rationale, and proceed.
</decision_authority>

<completion_condition>
This planning task is complete only when there is a coherent, evidence-informed product direction from which implementation can begin without re-solving the fundamental design problem.

Do not stop after summarizing the prompt.

Do the investigation.

Evaluate alternatives.

Resolve the major design and technical questions.

Then deliver the integrated plan.
</completion_condition>