import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { step as stepSchema, type Step } from '@atlas/schema';

export interface StepRefs {
  structures: ReadonlySet<string>;
  claims: ReadonlySet<string>;
  chapters: ReadonlySet<string>;
}

/**
 * Validate plate MDX files: frontmatter against the shared step schema, and every reference (structure ids in
 * the delta, labels and camera frames; chapters; supporting claims; inline <Claim id="…"> in the body).
 */
export function checkSteps(dir: string, refs: StepRefs): { errors: string[]; steps: Step[] } {
  const errors: string[] = [];
  const steps: Step[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mdx'));
  } catch {
    return { errors, steps };
  }
  for (const file of files) {
    const where = `steps/${file}`;
    const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!m) {
      errors.push(`${where}: missing frontmatter`);
      continue;
    }
    let front: unknown;
    try {
      front = parse(m[1]!);
    } catch (err) {
      errors.push(`${where}: frontmatter is not valid YAML: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    const parsed = stepSchema.safeParse(front);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${where}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      continue;
    }
    const s = parsed.data;
    steps.push(s);
    const need = (id: string, set: ReadonlySet<string>, kind: string) => {
      if (!set.has(id)) errors.push(`${where}: unknown ${kind} "${id}"`);
    };
    need(s.chapter, refs.chapters, 'chapter');
    for (const id of Object.keys(s.delta.structures ?? {})) need(id, refs.structures, 'structure');
    for (const l of s.delta.labels ?? []) need(l.structureId, refs.structures, 'label structure');
    for (const id of s.delta.camera?.frame ?? []) if (!/^specimen(@[0-9.]+)?$/.test(id)) need(id, refs.structures, 'camera frame structure');
    for (const c of s.claims) need(c, refs.claims, 'claim');
    for (const [, id] of m[2]!.matchAll(/<Claim\s+id="([^"]+)"/g)) need(id!, refs.claims, 'inline claim');
    if (!/<Claim\s/.test(m[2]!)) errors.push(`${where}: the plate text cites no claims`);
  }
  const ids = steps.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) errors.push(`steps: duplicate plate id "${dup}"`);
  const orders = steps.map((s) => s.order);
  if (new Set(orders).size !== orders.length) errors.push('steps: duplicate plate order');
  return { errors, steps };
}
