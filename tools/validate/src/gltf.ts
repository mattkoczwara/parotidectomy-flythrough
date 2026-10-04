import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Node names of a GLB (its JSON chunk is plain even when the buffers are meshopt-compressed). */
export function glbNodes(path: string): { meshes: Set<string>; anchors: Set<string> } {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as { nodes?: Array<{ name?: string; mesh?: number }> };
  const meshes = new Set<string>();
  const anchors = new Set<string>();
  for (const n of json.nodes ?? []) {
    if (!n.name) continue;
    if (n.name.startsWith('anchor__')) anchors.add(n.name);
    else if (n.mesh !== undefined) meshes.add(n.name);
  }
  return { meshes, anchors };
}

export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export interface FrameFile {
  bounds?: Record<string, unknown>;
  imaging?: unknown;
}
