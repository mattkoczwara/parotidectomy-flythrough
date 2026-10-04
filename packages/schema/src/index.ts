import { z } from 'zod';

/*
 * Content contracts shared by the Astro content collections, the anatomy pipeline and
 * tools/validate. Each collection lives in apps/site/src/content/<name>/, one JSON file per
 * record, with `id` equal to the file name. Cross-references (claim → source, structure →
 * asset, …) are checked by tools/validate, not here.
 */

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'ids are lowercase kebab/snake case');
const isoDate = z.iso.date();
const nonEmpty = z.string().trim().min(1);

// ── Sources ────────────────────────────────────────────────────────────────────────────────

export const publicationTypes = [
  'systematic-review',
  'meta-analysis',
  'network-meta-analysis',
  'cochrane-review',
  'randomised-trial',
  'cohort',
  'case-series',
  'cadaveric-study',
  'anatomical-study',
  'narrative-review',
  'guideline',
  'consensus',
  'reference-chapter',
  'institutional-protocol',
  'dataset',
  'software',
] as const;

export const source = z.strictObject({
  id,
  citation: z.strictObject({
    authors: z.array(nonEmpty).min(1),
    title: nonEmpty.optional(),
    container: nonEmpty,
    /** Omitted only for undated web protocols; `url` and `checkedDate` then carry the reference. */
    year: z.int().min(1800).max(2100).optional(),
    volume: nonEmpty.optional(),
    pages: nonEmpty.optional(),
  }),
  publicationType: z.enum(publicationTypes),
  pmid: z.string().regex(/^\d+$/).optional(),
  doi: z.string().regex(/^10\.\d{4,9}\/\S+$/).optional(),
  url: z.url().optional(),
  /** `retracted` sources stay on record so the validator can refuse any claim that cites them. */
  status: z.enum(['active', 'retracted', 'superseded']),
  retraction: z.strictObject({ date: isoDate, noticePmid: z.string().regex(/^\d+$/).optional() }).optional(),
  /** How much of the source has been read: numbers from `abstract` or `secondary` need confirming before display. */
  verification: z.enum(['full-text', 'abstract', 'secondary', 'citation-only']),
  checkedDate: isoDate,
  notes: nonEmpty.optional(),
});
export type Source = z.infer<typeof source>;

// ── Claims ─────────────────────────────────────────────────────────────────────────────────

export const evidenceClasses = [
  'established-anatomy',
  'standard-principle',
  'representative-technique',
  'varies-by-surgeon',
  'comparative-evidence',
  'uncertain',
] as const;

export const framedNumber = z
  .strictObject({
    label: nonEmpty,
    /** Point estimate, or the value as reported (e.g. a proportion as a percentage). Omitted when a source reports only a range. */
    value: z.number().optional(),
    unit: z.enum(['%', 'mm', 'cm', 'g', 'mL', 'OR', 'RR', 'months', 'days', 'years', 'hours', 'minutes', 'points', 'count']),
    ci: z.tuple([z.number(), z.number()]).optional(),
    range: z.tuple([z.number(), z.number()]).optional(),
    n: nonEmpty.optional(),
    /** Who the number describes; a number without its population is never displayed. */
    population: nonEmpty,
    design: nonEmpty,
    sourceId: id,
  })
  .refine((n) => n.value !== undefined || n.range !== undefined, 'a number needs a value or a reported range');
export type FramedNumber = z.infer<typeof framedNumber>;

export const claim = z.strictObject({
  id,
  statement: z.strictObject({
    essentials: nonEmpty,
    anatomy: nonEmpty.optional(),
    clinical: nonEmpty.optional(),
  }),
  evidenceClass: z.enum(evidenceClasses),
  sources: z
    .array(
      z.strictObject({
        sourceId: id,
        locator: nonEmpty.optional(),
        support: z.enum(['direct', 'indirect']),
      }),
    )
    .min(1),
  numbers: z.array(framedNumber).default([]),
  limitations: nonEmpty.optional(),
  disagreement: nonEmpty.optional(),
  lastChecked: isoDate,
  /**
   * `to-verify`: numbers or wording come from an abstract or a secondary extraction and must be confirmed
   * against the source before public display. The public build refuses to-verify claims (plan §10).
   */
  verification: z.enum(['checked', 'to-verify']),
  clinicalReview: z.strictObject({
    status: z.enum(['pending', 'approved', 'revise']),
    reviewer: nonEmpty.optional(),
    date: isoDate.optional(),
    notes: nonEmpty.optional(),
  }),
});
export type Claim = z.infer<typeof claim>;

// ── Structures ─────────────────────────────────────────────────────────────────────────────

export const tissueFamilies = [
  'skin',
  'fat',
  'fascia',
  'gland',
  'duct',
  'muscle',
  'bone',
  'cartilage',
  'nerve',
  'artery',
  'vein',
  'lymph-node',
  'tumour',
  /** Manufactured objects (probe, needle, drain): not anatomy, drawn as plain instruments. */
  'instrument',
] as const;

/** Positions on the plane gauge, superficial to deep. */
export const depthPlanes = [
  'skin',
  'subcutaneous',
  'smas-fascia',
  'superficial-lobe',
  'nerve-plane',
  'deep-lobe',
  'parapharyngeal',
  'skeletal',
] as const;

export const structure = z.strictObject({
  id,
  names: z.strictObject({
    plain: nonEmpty,
    anatomical: nonEmpty,
    latin: nonEmpty.optional(),
  }),
  ta2: z.string().regex(/^\d+$/).optional(),
  fma: z.string().regex(/^\d+$/).optional(),
  gloss: nonEmpty,
  tissue: z.enum(tissueFamilies),
  depth: z.enum(depthPlanes),
  /** glTF node names of label anchor empties. */
  anchors: z.array(nonEmpty).default([]),
  assetIds: z.array(id).default([]),
  claims: z.array(id).default([]),
  /** What it does, in a sentence (structure card; plan §4). */
  role: nonEmpty.optional(),
  /** Why it matters in this atlas (structure card). */
  matters: nonEmpty.optional(),
  /**
   * A group stands for several meshes (e.g. the superficial lobe is built from ESGS levels): plate patches for the
   * group apply to its members (@atlas/timeline compile `groups`). A group has no mesh of its own.
   */
  members: z.array(id).default([]),
  /** Schematic, not modelled anatomy: always drawn in the line/hatch grammar (plan §2). */
  schematic: z.boolean().default(false),
  /** Absent from the opening scene (props, imaging, alternatives and barriers): a plate has to bring it in. */
  hidden: z.boolean().default(false),
});
export type Structure = z.infer<typeof structure>;

// ── Assets & provenance ────────────────────────────────────────────────────────────────────

export const asset = z.strictObject({
  id,
  kind: z.enum(['source-data', 'derived-mesh', 'texture', 'font', 'image', 'model-weights']),
  source: z.strictObject({
    name: nonEmpty,
    url: z.url(),
    version: nonEmpty.optional(),
    retrieved: isoDate.optional(),
  }),
  licence: z.strictObject({
    /** SPDX id where one exists (e.g. CC-BY-4.0), otherwise a short name. */
    id: nonEmpty,
    url: z.url(),
    obligations: z.array(nonEmpty).default([]),
    /** ADR that justifies using a licence outside the default allow-list. */
    exceptionAdr: nonEmpty.optional(),
  }),
  attribution: nonEmpty,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Path of the shipped file (repo-relative); when given, the validator recomputes the checksum. */
  file: nonEmpty.optional(),
  derivedFrom: z.array(id).default([]),
  transformations: z.array(nonEmpty).default([]),
  specClaims: z.array(id).default([]),
});
export type Asset = z.infer<typeof asset>;

// ── Glossary ───────────────────────────────────────────────────────────────────────────────

export const glossaryEntry = z.strictObject({
  id,
  term: nonEmpty,
  plain: nonEmpty,
  definition: nonEmpty,
  structureId: id.optional(),
  claims: z.array(id).default([]),
});
export type GlossaryEntry = z.infer<typeof glossaryEntry>;

// ── Plates (step frontmatter) ──────────────────────────────────────────────────────────────
// Mirrors PlateSpec in @atlas/timeline; a type test there keeps the two in step.

const unit = z.number().min(0).max(1);
const span = z.tuple([unit, unit]).refine(([a, b]) => a < b, 'window start must precede end');

export const plateDelta = z.strictObject({
  camera: z
    .strictObject({
      azimuth: z.number().optional(),
      elevation: z.number().min(-89).max(89).optional(),
      zoom: z.number().positive().optional(),
      /** Structure ids to frame; `specimen` and `specimen@0.45` frame the lifted pieces (at the end, or part-way through their move). */
      frame: z.array(z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:@\d+(?:\.\d+)?)?$/, 'a structure id, or specimen@amount')).min(1).optional(),
    })
    .optional(),
  structures: z
    .record(
      id,
      z.strictObject({
        presence: unit.optional(),
        opacity: unit.optional(),
        mode: z.enum(['solid', 'ghost', 'hatch', 'illustrative']).optional(),
        emphasis: z.enum(['focus', 'context', 'dim']).optional(),
      }),
    )
    .optional(),
  gauge: z.number().min(0).max(depthPlanes.length - 1).optional(),
  op: z.record(nonEmpty, z.number()).optional(),
  variants: z.record(nonEmpty, nonEmpty).optional(),
  labels: z.array(z.strictObject({ structureId: id, priority: z.int().min(0).optional() })).max(10).optional(),
  light: z.strictObject({ preset: z.enum(['studio', 'operative', 'specimen']).optional(), exposure: z.number().positive().optional() }).optional(),
});

export const step = z.strictObject({
  /** Plate id; also the URL fragment (#id). */
  id,
  chapter: id,
  order: z.int().min(0),
  title: nonEmpty,
  delta: plateDelta,
  transition: z
    .strictObject({ camera: span.optional(), structures: span.optional(), op: span.optional(), labels: span.optional(), opKeys: z.record(nonEmpty, span).optional() })
    .optional(),
  /** What is visible, cut, retracted or at risk — the assistive-technology and static-figure description. */
  sceneDescription: nonEmpty,
  /** Claims supporting the scene itself (e.g. anatomical relationships shown), beyond those cited in the text. */
  claims: z.array(id).default([]),
});
export type Step = z.infer<typeof step>;

export const chapter = z.strictObject({
  id,
  order: z.int().min(0),
  title: nonEmpty,
  /** Short label for the chapter rail. */
  short: nonEmpty,
});
export type Chapter = z.infer<typeof chapter>;

// ── Registry ───────────────────────────────────────────────────────────────────────────────

/**
 * Content collections validated by tools/validate, keyed by directory name under
 * apps/site/src/content/. A content directory without an entry here fails validation.
 */
export const collections = {
  sources: source,
  claims: claim,
  structures: structure,
  assets: asset,
  glossary: glossaryEntry,
} as const satisfies Record<string, z.ZodType>;

export type CollectionName = keyof typeof collections;

/** Licence ids allowed without an ADR exception. */
export const allowedLicences = [
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Apache-2.0',
  'MIT',
  'BSD-3-Clause',
  'OFL-1.1',
  'NLM-VHP',
] as const;
