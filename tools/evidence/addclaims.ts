/*
 * Write claim records from a batch file, validating each against the shared schema.
 *
 *   npx tsx tools/evidence/addclaims.ts <batch.json> [--overwrite]
 *
 * A batch is a JSON array of claims. Defaults are filled: `numbers: []`, `lastChecked` today, `verification`
 * 'to-verify' and `clinicalReview` pending. A claim is only given `verification: 'checked'` by the author who has
 * compared its wording and numbers with the cited source text (docs/m2-m5-implementation.md, evidence rules).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { claim } from '@atlas/schema';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: addclaims.ts <batch.json> [--overwrite]');
  process.exit(2);
}
const dir = resolve(import.meta.dirname, '../../apps/site/src/content/claims');
const today = new Date().toISOString().slice(0, 10);
const batch = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
let failed = 0;
for (const raw of batch) {
  const withDefaults = { numbers: [], lastChecked: today, verification: 'to-verify', clinicalReview: { status: 'pending' }, ...raw };
  const parsed = claim.safeParse(withDefaults);
  if (!parsed.success) {
    failed++;
    console.error(`${String(raw['id'])}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  const target = join(dir, `${parsed.data.id}.json`);
  if (existsSync(target) && !flags.includes('--overwrite')) {
    console.error(`${parsed.data.id}: exists (use --overwrite)`);
    failed++;
    continue;
  }
  writeFileSync(target, JSON.stringify(parsed.data, null, 2) + '\n');
  console.log(`wrote ${parsed.data.id}`);
}
process.exit(failed ? 1 : 0);
