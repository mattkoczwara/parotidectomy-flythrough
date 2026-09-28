import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { collections, type CollectionName } from '@atlas/schema';
import { checkContent, type Content } from './checks.ts';
import { checkSteps } from './steps.ts';

const root = resolve(import.meta.dirname, '../../..');
const contentRoot = join(root, 'apps/site/src/content');

const errors: string[] = [];
const content: Content = { sources: [], claims: [], structures: [], assets: [], glossary: [] };
let files = 0;

function isCollection(name: string): name is CollectionName {
  return Object.hasOwn(collections, name);
}

if (existsSync(contentRoot)) {
  for (const entry of readdirSync(contentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // MDX step collections are validated by Astro's content layer at build time.
    if (name === 'steps' || name === 'chapters') continue;
    if (!isCollection(name)) {
      errors.push(`content/${name}: no schema registered in @atlas/schema`);
      continue;
    }
    for (const file of readdirSync(join(contentRoot, name))) {
      const path = join(contentRoot, name, file);
      const where = relative(root, path).replaceAll('\\', '/');
      if (!file.endsWith('.json')) {
        errors.push(`${where}: only .json records are allowed in data collections`);
        continue;
      }
      files++;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(path, 'utf8'));
      } catch (e) {
        errors.push(`${where}: invalid JSON (${(e as Error).message})`);
        continue;
      }
      const result = collections[name].safeParse(data);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(`${where}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
        }
        continue;
      }
      if (result.data.id !== basename(file, '.json')) {
        errors.push(`${where}: id "${result.data.id}" must match the file name`);
      }
      (content[name] as unknown[]).push(result.data);
    }
  }
}

errors.push(...checkContent(content));

// Plates (MDX): schema and every reference; chapters are small JSON records read directly.
const chapterDir = join(contentRoot, 'chapters');
const chapters = existsSync(chapterDir)
  ? readdirSync(chapterDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => (JSON.parse(readFileSync(join(chapterDir, f), 'utf8')) as { id: string }).id)
  : [];
const stepResult = checkSteps(join(contentRoot, 'steps'), {
  structures: new Set(content.structures.map((s) => s.id)),
  claims: new Set(content.claims.map((c) => c.id)),
  chapters: new Set(chapters),
});
errors.push(...stepResult.errors);

if (errors.length > 0) {
  console.error(`validate: ${errors.length} error(s)`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
const counts = Object.entries(content)
  .map(([k, v]) => `${v.length} ${k}`)
  .join(', ');
const toVerify = content.claims.filter((c) => c.verification === 'to-verify').length;
const pendingReview = content.claims.filter((c) => c.clinicalReview.status !== 'approved').length;
console.log(`validate: ok (${files} file(s): ${counts}; ${stepResult.steps.length} plates)`);
// Not errors during development; the public build must refuse these (plan §10).
console.log(`validate: ${toVerify} claim(s) to verify against sources; ${pendingReview} awaiting clinical review`);
