import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { collections } from '@atlas/schema';

const root = resolve(import.meta.dirname, '../../..');
const contentRoot = join(root, 'apps/site/src/content');

const errors: string[] = [];
let checked = 0;

if (existsSync(contentRoot)) {
  for (const entry of readdirSync(contentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const schema = collections[entry.name];
    if (!schema) {
      errors.push(`content/${entry.name}: no schema registered in @atlas/schema`);
      continue;
    }
    for (const file of readdirSync(join(contentRoot, entry.name))) {
      if (!file.endsWith('.json')) continue;
      const path = join(contentRoot, entry.name, file);
      const result = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      checked++;
      if (!result.success) {
        errors.push(`${relative(root, path)}: ${result.error.message}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`validate: ${errors.length} error(s)`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`validate: ok (${checked} file(s), ${Object.keys(collections).length} collection schema(s))`);
