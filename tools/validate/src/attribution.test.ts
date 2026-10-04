import { describe, expect, it } from 'vitest';
import { checkAttribution } from './attribution.ts';

describe('checkAttribution', () => {
  it('accepts claim-wrapped and Model paragraphs', () => {
    const body = `import Claim from '../x.astro';\n\n<Claim id="a">The gland is large.</Claim> <Model>It is drawn pale.</Model>\n\n<Model>Everything here is about the picture.</Model>\n`;
    expect(checkAttribution('t', body)).toEqual([]);
  });
  it('refuses a paragraph with neither', () => {
    expect(checkAttribution('t', '<Claim id="a">x</Claim>\n\nThe nerve is always found at one centimetre.\n').join()).toMatch(/neither a claim nor a Model/);
  });
  it('refuses long unattributed prose beside a claim, but not a few connecting words', () => {
    expect(checkAttribution('t', '<Claim id="a">x</Claim> and then the surgeon always lifts the whole lobe off the nerve without any difficulty at all.\n').join()).toMatch(/unattributed prose/);
    expect(checkAttribution('t', 'Several landmarks point to it: <Claim id="a">a seam in the bone.</Claim>\n')).toEqual([]);
  });
  it('ignores blocks that are only components, and the insides of notes and insets', () => {
    expect(checkAttribution('t', '<Framed claim="a" />\n\n<Note title="n">\nprose that lives in a note\n</Note>\n')).toEqual([]);
  });
});
