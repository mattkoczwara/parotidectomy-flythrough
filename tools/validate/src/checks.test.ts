import { describe, expect, it } from 'vitest';
import { claim as claimSchema, source as sourceSchema, type Claim, type Source } from '@atlas/schema';
import { checkContent, type Content } from './checks.ts';

const baseSource: Source = sourceSchema.parse({
  id: 'buntain-2026',
  citation: { authors: ['Buntain H'], container: 'ANZ J Surg', year: 2026 },
  publicationType: 'meta-analysis',
  pmid: '42533397',
  status: 'active',
  verification: 'abstract',
  checkedDate: '2026-09-28',
});

const baseClaim: Claim = claimSchema.parse({
  id: 'monitoring-immediate',
  statement: { essentials: 'Nerve monitoring lowers the chance of weakness right after surgery.' },
  evidenceClass: 'comparative-evidence',
  sources: [{ sourceId: 'buntain-2026', support: 'direct' }],
  numbers: [
    {
      label: 'Immediate dysfunction, monitored vs not',
      value: 0.48,
      unit: 'OR',
      ci: [0.31, 0.72],
      n: '10 studies, 2,042 patients',
      population: 'Parotidectomy, mixed benign and malignant',
      design: 'Meta-analysis of mostly observational studies',
      sourceId: 'buntain-2026',
    },
  ],
  lastChecked: '2026-09-28',
  verification: 'to-verify',
  clinicalReview: { status: 'pending' },
});

function content(overrides: Partial<Content> = {}): Content {
  return { sources: [baseSource], claims: [baseClaim], structures: [], assets: [], glossary: [], ...overrides };
}

describe('checkContent', () => {
  it('accepts consistent content', () => {
    expect(checkContent(content())).toEqual([]);
  });

  it('refuses a known-retracted PMID that is not marked retracted', () => {
    const barrameda = { ...baseSource, id: 'barrameda-2026', pmid: '41353726' };
    expect(checkContent(content({ sources: [baseSource, barrameda] })).join()).toMatch(/is retracted/);
  });

  it('refuses claims that cite a retracted source', () => {
    const retracted: Source = { ...baseSource, status: 'retracted', retraction: { date: '2026-07-28' } };
    expect(checkContent(content({ sources: [retracted] })).join()).toMatch(/cites retracted source/);
  });

  it('flags a point estimate outside its CI', () => {
    const bad: Claim = { ...baseClaim, numbers: [{ ...baseClaim.numbers[0]!, value: 0.9 }] };
    expect(checkContent(content({ claims: [bad] })).join()).toMatch(/outside its CI/);
  });

  it('requires numbers to come from a cited source', () => {
    const bad: Claim = { ...baseClaim, numbers: [{ ...baseClaim.numbers[0]!, sourceId: 'elsewhere' }] };
    expect(checkContent(content({ claims: [bad] })).join()).toMatch(/does not cite/);
  });

  it('rejects share-alike assets without an ADR exception', () => {
    const errors = checkContent(
      content({
        assets: [
          {
            id: 'z-anatomy',
            kind: 'source-data',
            source: { name: 'Z-Anatomy', url: 'https://github.com/Z-Anatomy/Models-of-human-anatomy' },
            licence: { id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', obligations: [] },
            attribution: 'Z-Anatomy',
            derivedFrom: [],
            transformations: [],
            specClaims: [],
          },
        ],
      }),
    );
    expect(errors.join()).toMatch(/outside the allow-list/);
  });
});
