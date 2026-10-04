/*
 * Refresh each glossary definition from its first claim, so the glossary never drifts from the evidence (the validator
 * refuses a definition that matches no level of that claim).
 *
 *   npx tsx tools/evidence/syncglossary.ts
 *
 * An entry keeps the level (essentials, anatomy or clinical) it was using when that level still exists; otherwise it takes
 * the claim's essentials.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const content = resolve(import.meta.dirname, '../../apps/site/src/content');
const read = (dir: string, file: string) => JSON.parse(readFileSync(join(content, dir, file), 'utf8')) as Record<string, any>;
const claims = new Map(readdirSync(join(content, 'claims')).map((f) => [f.replace(/\.json$/, ''), read('claims', f)]));
let changed = 0;
for (const f of readdirSync(join(content, 'glossary'))) {
  const g = read('glossary', f);
  const claim = claims.get(g['claims'][0]);
  if (!claim) continue;
  const levels = ['essentials', 'anatomy', 'clinical'].map((k) => claim['statement'][k] as string | undefined);
  if (levels.includes(g['definition'])) continue;
  g['definition'] = levels[0];
  writeFileSync(join(content, 'glossary', f), JSON.stringify(g, null, 2) + '\n');
  changed++;
  console.log(`updated ${f}`);
}
console.log(`${changed} definition(s) refreshed`);
