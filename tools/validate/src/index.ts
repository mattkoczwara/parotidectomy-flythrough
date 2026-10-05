import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { collections, type CollectionName } from '@atlas/schema';
import { checkContent, type Content } from './checks.ts';
import { checkSteps } from './steps.ts';
import { glbNodes, sha256File, type FrameFile } from './gltf.ts';

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

// Shipped files: recompute checksums; every structure must exist in the glTF scene (mesh node, anchor or framing bounds).
for (const a of content.assets) {
  if (!a.file) continue;
  const path = join(root, a.file);
  if (!existsSync(path)) {
    errors.push(`assets/${a.id}: file "${a.file}" does not exist`);
    continue;
  }
  const actual = sha256File(path);
  if (a.sha256 && a.sha256 !== actual) errors.push(`assets/${a.id}: sha256 does not match ${a.file} (record ${a.sha256.slice(0, 12)}…, file ${actual.slice(0, 12)}…)`);
}
const glbPath = join(root, 'apps/site/public/assets/anatomy/slice.glb');
const framePath = join(root, 'apps/site/public/assets/anatomy/frame.json');
if (existsSync(glbPath) && existsSync(framePath)) {
  const { meshes, anchors } = glbNodes(glbPath);
  const frame = JSON.parse(readFileSync(framePath, 'utf8')) as FrameFile;
  const bounds = new Set(Object.keys(frame.bounds ?? {}));
  const structureIds = new Set(content.structures.map((s) => s.id));
  for (const s of content.structures) {
    const placed = meshes.has(s.id) || anchors.has(`anchor__${s.id}`) || bounds.has(s.id) || s.members.length > 0 || (s.id === 'ct_slice' && !!frame.imaging);
    if (!placed) errors.push(`structures/${s.id}: no matching glTF node, anchor, group or framing bounds`);
    for (const a of s.anchors) if (!anchors.has(a)) errors.push(`structures/${s.id}: anchor "${a}" is not in the glTF scene`);
    for (const m of s.members) if (!structureIds.has(m)) errors.push(`structures/${s.id}: unknown member "${m}"`);
  }
  // Presentation-only meshes (ADR-0005): the exterior body below the neck cut and the hair carry no anatomy and no
  // claim; the stage draws them with the skin's authored state.
  const presentation = new Set(['exterior_body', 'hair']);
  for (const m of meshes) if (!structureIds.has(m) && !presentation.has(m)) errors.push(`glTF mesh "${m}" has no structure record`);
}

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

// A public build refuses what the private one only reports (plan §10): claims not yet compared with their sources, and
// claims a clinician has not approved. `npm run validate:public` / `npm run build:public`.
const publicBuild = process.argv.includes('--public') || process.env['ATLAS_PUBLIC'] === '1';
if (publicBuild) {
  for (const c of content.claims) {
    if (c.verification === 'to-verify') errors.push(`public build: claims/${c.id} is still marked to-verify`);
    if (c.clinicalReview.status !== 'approved') errors.push(`public build: claims/${c.id} has clinical review status "${c.clinicalReview.status}"`);
  }
}

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
