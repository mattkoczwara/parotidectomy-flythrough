/*
 * Recompute the sha256 of every shipped asset that names a `file`, and write it into its record
 * (apps/site/src/content/assets). Run after the anatomy build; `npm run validate` fails if a record is stale.
 *
 *   node tools/evidence/checksums.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dir = join(root, 'apps/site/src/content/assets');
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const path = join(dir, f);
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  if (!rec.file) continue;
  const file = join(root, rec.file);
  if (!existsSync(file)) {
    console.error(`${f}: ${rec.file} is missing`);
    process.exitCode = 1;
    continue;
  }
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha !== rec.sha256) {
    rec.sha256 = sha;
    writeFileSync(path, JSON.stringify(rec, null, 2) + '\n');
    console.log(`${f}: updated ${sha.slice(0, 12)}…`);
  }
}
