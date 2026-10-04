import { allowedLicences, type Asset, type Claim, type GlossaryEntry, type Source, type Structure } from '@atlas/schema';

/** PMIDs known to be retracted. A source with one of these must be marked retracted and never cited. */
export const retractedPmids: ReadonlyMap<string, string> = new Map([
  ['41353726', 'Barrameda 2026, facial nerve monitoring meta-analysis; retracted 2026-07-28 (notice PMID 42520282)'],
]);

export interface Content {
  sources: Source[];
  claims: Claim[];
  structures: Structure[];
  assets: Asset[];
  glossary: GlossaryEntry[];
}

/** Cross-reference and policy checks over already schema-valid content. Returns error messages. */
export function checkContent(content: Content): string[] {
  const errors: string[] = [];
  const sources = new Map(content.sources.map((s) => [s.id, s]));
  const claimIds = new Set(content.claims.map((c) => c.id));
  const assetIds = new Set(content.assets.map((a) => a.id));
  const structureIds = new Set(content.structures.map((s) => s.id));

  for (const s of content.sources) {
    const known = s.pmid ? retractedPmids.get(s.pmid) : undefined;
    if (known && s.status !== 'retracted') {
      errors.push(`sources/${s.id}: PMID ${s.pmid} is retracted (${known}) but status is "${s.status}"`);
    }
    if (s.status === 'retracted' && !s.retraction) {
      errors.push(`sources/${s.id}: retracted source needs retraction details`);
    }
  }

  for (const c of content.claims) {
    const cited = new Set(c.sources.map((s) => s.sourceId));
    for (const ref of c.sources) {
      const s = sources.get(ref.sourceId);
      if (!s) errors.push(`claims/${c.id}: unknown source "${ref.sourceId}"`);
      else if (s.status === 'retracted') errors.push(`claims/${c.id}: cites retracted source "${s.id}"`);
    }
    if (c.verification === 'checked') {
      for (const ref of c.sources) {
        const v = sources.get(ref.sourceId)?.verification;
        if (v === 'citation-only' || v === 'secondary') errors.push(`claims/${c.id}: marked checked but "${ref.sourceId}" was read only at ${v} level`);
      }
    }
    for (const n of c.numbers) {
      if (!cited.has(n.sourceId)) {
        errors.push(`claims/${c.id}: number "${n.label}" comes from "${n.sourceId}", which the claim does not cite`);
      }
      if (n.ci && n.ci[0] > n.ci[1]) errors.push(`claims/${c.id}: number "${n.label}" has an inverted CI`);
      if (n.range && n.range[0] > n.range[1]) errors.push(`claims/${c.id}: number "${n.label}" has an inverted range`);
      if (n.ci && n.value !== undefined && (n.value < n.ci[0] || n.value > n.ci[1])) {
        errors.push(`claims/${c.id}: number "${n.label}" point estimate lies outside its CI`);
      }
    }
  }

  for (const s of content.structures) {
    for (const a of s.assetIds) if (!assetIds.has(a)) errors.push(`structures/${s.id}: unknown asset "${a}"`);
    for (const c of s.claims) if (!claimIds.has(c)) errors.push(`structures/${s.id}: unknown claim "${c}"`);
    // A card says no more than the evidence: its role and its reason it matters are claim wording, verbatim.
    const levels = s.claims.flatMap((id) => {
      const c = content.claims.find((x) => x.id === id);
      return c ? [c.statement.essentials, c.statement.anatomy, c.statement.clinical] : [];
    });
    for (const [field, text] of [['role', s.role], ['matters', s.matters]] as const) {
      if (text && !levels.includes(text)) errors.push(`structures/${s.id}: ${field} is not the wording of any claim the structure cites`);
    }
  }

  const allowed: readonly string[] = allowedLicences;
  for (const a of content.assets) {
    if (!allowed.includes(a.licence.id) && !a.licence.exceptionAdr) {
      errors.push(`assets/${a.id}: licence "${a.licence.id}" is outside the allow-list and has no ADR exception`);
    }
    // Source data and weights are checksummed in pipeline/sources manifests; fonts are fetched, subset and
    // content-hashed per file by the Astro Fonts API at build time; libraries are pinned by the lockfile.
    if (a.kind !== 'source-data' && a.kind !== 'model-weights' && a.kind !== 'font' && a.kind !== 'software' && !a.sha256) {
      errors.push(`assets/${a.id}: shipped asset needs a sha256`);
    }
    if (a.kind === 'derived-mesh' && a.derivedFrom.length === 0) {
      errors.push(`assets/${a.id}: derived mesh must name what it was derived from`);
    }
    for (const d of a.derivedFrom) if (!assetIds.has(d)) errors.push(`assets/${a.id}: unknown parent asset "${d}"`);
    for (const c of a.specClaims) if (!claimIds.has(c)) errors.push(`assets/${a.id}: unknown claim "${c}"`);
  }

  for (const g of content.glossary) {
    if (g.structureId && !structureIds.has(g.structureId)) {
      errors.push(`glossary/${g.id}: unknown structure "${g.structureId}"`);
    }
    for (const c of g.claims) if (!claimIds.has(c)) errors.push(`glossary/${g.id}: unknown claim "${c}"`);
    // A definition is a claim's own wording, so it cannot drift from the evidence: it must equal one level of the first claim.
    const first = content.claims.find((c) => c.id === g.claims[0]);
    if (first && ![first.statement.essentials, first.statement.anatomy, first.statement.clinical].includes(g.definition)) {
      errors.push(`glossary/${g.id}: definition does not match any level of claim "${first.id}" (regenerate it from the claim)`);
    }
  }

  return errors;
}
