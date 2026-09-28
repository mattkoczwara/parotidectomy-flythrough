# Research References — Interactive Parotid Surgery Atlas

> **Revision 2026-09-28 (planning review):**
> - The §2 "Rea et al." entry's PMID and DOI actually identify Kochhar et al. 2016. It is re-attributed, and the real Rea 2010 paper is added.
> - The §4 Barrameda 2026 paper is marked **retracted**.
> - A single-arm-pooling caveat is added to the §3 ECD vs SP meta-analysis (Salzano 2025).
> - A verification note is added for the Milan 2nd-edition risk figures in §6.
>
> The full verified evidence base will live as structured source and claim records in the site's content collections from M0.

This file is a curated starting bibliography for the project. It is not exhaustive and should not be treated as a substitute for ongoing literature review. Verify publication details, currentness, licensing, and any claim you intend to surface in the product.

## 1. Claude Opus 5.5 / Claude Code prompting and agent design

### Anthropic — Prompting Claude Opus 5.5
https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5

Why it matters:
- Official model-specific guidance.
- Covers effort calibration, always-on adaptive thinking, long unattended agent runs, progress updates, multiagent work, complex visual inputs, and frontend design defaults.
- Particularly relevant to allowing Claude Code to plan and implement autonomously without over-prescribing its reasoning.

### Anthropic — Prompting best practices
https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

Why it matters:
- Official general prompting guidance for current Claude models.
- Recommends clear/direct instructions, context and motivation, right-sized structure, general instructions over hand-written chains of thought, natural subagent orchestration, long-horizon state tracking, and explicit success criteria.

### Anthropic — Effective context engineering for AI agents
https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Why it matters:
- Useful framing for keeping the project prompt at the "right altitude": enough context and constraints to guide the agent without brittle procedural micromanagement.
- Strong rationale for high-signal project state, tools, and persistent context.

### Anthropic — Claude Opus 5.5
https://www.anthropic.com/claude-opus-5-5

Why it matters:
- Model capability/release information.
- Anthropic describes Opus 5.5 as especially strong in long-running agentic coding, code review, subagent coordination, and token-efficient completion of large engineering tasks.

---

## 2. Core parotidectomy references

### El Sayed Ahmad Y, Winters R. Parotidectomy. StatPearls / NCBI Bookshelf. Updated June 17, 2026.
https://www.ncbi.nlm.nih.gov/books/NBK557651/

Use for:
- overall surgical anatomy;
- indications and procedure types;
- facial-nerve relationship;
- positioning and exposure;
- facial-nerve monitoring;
- operative technique;
- complications and perioperative concepts.

Important note:
This is an excellent orientation source, but claims—especially numerical ones—should be cross-checked against primary literature or systematic reviews when possible.

### University of Iowa Head and Neck Protocols — Parotidectomy with Facial Nerve Dissection
https://iowaprotocols.medicine.uiowa.edu/protocols/parotidectomy-facial-nerve-dissections

Use for:
- detailed operative sequence;
- modified Blair-type exposure;
- great auricular nerve considerations;
- digastric, tragal pointer, tympanomastoid landmark concepts;
- facial-nerve trunk identification;
- pes anserinus and branch dissection;
- representative instruments;
- nerve stimulation;
- drain and closure concepts.

Important note:
This is a respected academic protocol illustrating one institutional approach. Do not present every detail as universally required.

### Kochhar A, Larian B, Azizzadeh B. Facial Nerve and Parotid Gland Anatomy. Otolaryngologic Clinics of North America. 2016;49:273.
PubMed: https://pubmed.ncbi.nlm.nih.gov/27040583/
DOI: 10.1016/j.otc.2015.10.002

> **Correction (2026-09-28):** This entry was previously attributed to "Rea PM, McGarry G, Shaw-Dunn J". The PMID and DOI actually identify Kochhar, Larian & Azizzadeh (2016), a narrative review. The Rea et al. paper is listed separately below.

Use for:
- facial-nerve anatomy;
- parotid anatomy and physiology;
- important surgical landmarks;
- branch course and relationships.

### Rea PM, McGarry G, Shaw-Dunn J. Cadaveric study of surgical landmarks for locating the facial-nerve trunk (exact title to be confirmed). Annals of Anatomy. 2010.
PubMed: https://pubmed.ncbi.nlm.nih.gov/19883997/

Use for:
- measured distances from the tympanomastoid suture, posterior belly of digastric, tragal pointer and external auditory canal to the facial-nerve trunk (26 cadavers).

Important note:
These distances disagree with Witt 2005 (PMID 15805861) and Pather & Osman 2006 (PMID 16636775), because the studies measured from different reference points. Present them as a range with each study's figure. Do not merge them into one number.

---

## 3. Pleomorphic adenoma pathology and management

### Menon G, Winters R. Pleomorphic Adenoma. StatPearls / NCBI Bookshelf. Updated December 13, 2025.
https://www.ncbi.nlm.nih.gov/books/NBK430829/

Use for:
- high-level pathology;
- clinical presentation;
- diagnostic workup;
- pseudocapsule/pseudopod concepts;
- treatment overview.

Important note:
Cross-check specific risk estimates and treatment-selection claims against the primary literature before displaying them as quantitative facts.

### Dulguerov P, Todic J, Pusztaszeri M, Alotaibi NH. Why Do Parotid Pleomorphic Adenomas Recur? A Systematic Review of Pathological and Surgical Variables.
PubMed: https://pubmed.ncbi.nlm.nih.gov/28555187/

Use for:
- incomplete/thin capsule;
- pseudopodia;
- satellite nodules;
- relationship of margins, puncture/spillage, tumor factors, and recurrence.

This is particularly useful when designing the microscopic-to-gross explanation of why pleomorphic adenoma should not be depicted as a perfectly encapsulated marble that is simply "popped out."

### Updated systematic review/meta-analysis — Pleomorphic Adenoma: Extracapsular Dissection vs. Superficial Parotidectomy
PubMed: https://pubmed.ncbi.nlm.nih.gov/40843726/
PMC full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC12372145/

Use for:
- modern evidence that selected small, mobile, superficial pleomorphic adenomas may be treated by more than one surgical strategy;
- recurrence and complication comparisons;
- avoiding the false implication that superficial parotidectomy is the only contemporary operation for every pleomorphic adenoma.

Important note:
Selection criteria matter. Do not generalize results for small mobile superficial tumors to deep, recurrent, large, suspicious, or malignant lesions.

> **Caveat (2026-09-28):** This is Salzano G et al., *Med Sci (Basel)* 2025;13:104, DOI 10.3390/medsci13030104. It pools each arm separately (a single-arm pooled-proportion analysis), so ECD vs SP is compared **indirectly**. 17 of its 21 studies are retrospective. It also has internal numerical inconsistencies: some point estimates fall outside their stated CIs. Cross-check with Albergotti 2012 (PMID 22753318) and Bernhard, Schlattmann & Guntinas-Lichius 2026 (*Front Surg*, DOI 10.3389/fsurg.2026.1836835, network meta-analysis; PMID not yet confirmed).

---

## 4. Facial-nerve monitoring

### Buntain H, et al. The Impact of Intraoperative Facial Nerve Monitoring During Parotidectomy on Postoperative Facial Nerve Function: A Systematic Review and Meta-Analysis. 2026.
PubMed: https://pubmed.ncbi.nlm.nih.gov/42533397/

Use for:
- current evidence on intraoperative facial-nerve monitoring;
- immediate versus permanent facial nerve dysfunction;
- uncertainty and subgroup limitations.

### ~~Barrameda BN, et al. Efficacy of Intraoperative Facial Nerve Monitoring in Parotidectomy: A Systematic Review and Meta-Analysis (1970–2025). Otolaryngology–Head and Neck Surgery. 2026.~~ RETRACTED
PubMed: https://pubmed.ncbi.nlm.nih.gov/41353726/

> **RETRACTED (2026-07-28; retraction notice PMID 42520282).** Do not cite. It is on the validator's blocklist.

It was the only pooled analysis reporting a reduction in *permanent* dysfunction, so the apparent disagreement between the monitoring meta-analyses no longer stands. The remaining evidence (Buntain 2026; Sood 2015, PMID 25628369) is consistent: monitoring reduces **immediate** postoperative weakness, while any effect on **permanent** weakness is unproven. The site should still avoid presenting "nerve monitor = prevents nerve injury" as a categorical claim.

---

## 5. Frey syndrome and reconstruction/barrier techniques

### Dulguerov N, Makni A, Dulguerov P. The superficial musculoaponeurotic system flap in the prevention of Frey syndrome: A meta-analysis. Laryngoscope. 2016.
PubMed: https://pubmed.ncbi.nlm.nih.gov/26915301/

Use for:
- the anatomical and reconstructive rationale for SMAS interposition;
- evidence that technique can influence clinical Frey syndrome.

### Different Surgical Strategies in the Prevention of Frey Syndrome: A Systematic Review and Network Meta-analysis.
PubMed: https://pubmed.ncbi.nlm.nih.gov/33502015/

Use for:
- broader comparison of reconstructive/interposition strategies after parotidectomy;
- illustrating that closure/reconstruction can vary.

---

## 6. Fine-needle aspiration / cytopathology

### Update on Salivary Gland Fine-Needle Aspiration and the Milan System for Reporting Salivary Gland Cytopathology
PubMed: https://pubmed.ncbi.nlm.nih.gov/37226841/

Use for:
- what FNA contributes;
- why salivary cytology reporting is standardized;
- the Milan System framework;
- the distinction between cytologic assessment and definitive surgical pathology.

> **To verify (2026-09-28):** The Milan System 2nd-edition implied risk-of-malignancy figures were found only in a secondary summary (CAP Today). Confirm them against the primary source before displaying: Rossi ED et al. 2024, *Cancer Cytopathol* DOI 10.1002/cncy.22753 / *J Am Soc Cytopathol* PMID 38184365. Wang 2022 (PMID 35637572) gives pooled values for comparison.

---

## 7. Anatomical / 3D source datasets

These are potential geometry or reference sources, not automatically approved assets. Verify the license of every actual file used.

### NIH 3D
About: https://3d.nih.gov/about
Terms: https://3d.nih.gov/terms

Why useful:
- NIH-operated repository for biomedical 3D visualization/printing models.
- Contains anatomy and scientific models.

Licensing caution:
NIH 3D entries can carry different licenses. The repository explicitly requires users to check each entry's license. Hosting on NIH 3D does not by itself make a model public domain or unrestricted.

### National Library of Medicine — Visible Human Project
Overview:
https://www.nlm.nih.gov/research/visible/visible_human.html

Data access:
https://www.nlm.nih.gov/research/visible/getting_data.html

Open Data Portal:
https://datadiscovery.nlm.nih.gov/Images/Visible-Human-Project/ux2j-9i9a/about_data

Why useful:
- public anatomical CT, MRI, and cryosection reference datasets;
- highly valuable for cross-sectional anatomy, anatomical proportions, and 3D reconstruction reference.

### BodyParts3D / Anatomography
Current database/license information:
https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html

License page:
https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html

Why useful:
- structured 3D human anatomical geometry;
- useful as an anatomical reference or potential asset source.

Licensing note:
The current database page states CC BY 4.0. Verify the specific version/files incorporated and preserve required attribution.

### Z-Anatomy
Community:
https://z-anatomy-community.github.io/

Model repository:
https://github.com/Z-Anatomy/Models-of-human-anatomy

Why useful:
- open 3D anatomical atlas ecosystem;
- may provide useful geometry and references for cranial nerves and head/neck structures.

Licensing caution:
The ecosystem has historically combined assets from multiple sources with different licenses. Inspect provenance at the individual-asset level rather than assuming a single license applies to everything.

---

## 8. Source-use rules for this project

When writing or visualizing a medical claim:

1. Prefer a current systematic review/meta-analysis or guideline for comparative outcomes and numerical risks.
2. Prefer peer-reviewed anatomy literature for anatomical relationships and recognized variants.
3. Use academic surgical protocols to understand technique, sequence, instruments, and operative rationale, while labeling them as representative approaches.
4. Use StatPearls/NCBI for orientation and synthesis, then follow its citations when a claim is important or contested.
5. Avoid sourcing numerical complication rates from generic hospital marketing or consumer-health pages when better evidence exists.
6. Keep recurrence, facial-nerve injury, Frey syndrome, and procedure-selection claims tied to the population studied.
7. Distinguish benign primary surgery from recurrent disease, malignant disease, deep-lobe disease, and reoperative surgery.
8. Never imply that a 3D model is a patient-specific surgical plan unless it actually derives from that patient's imaging and clinical plan.
9. Track asset licensing separately from medical evidence. A medically trustworthy source may still have restrictive copyright terms.
10. Record when each source was last checked so the evidence base can be maintained over time.
