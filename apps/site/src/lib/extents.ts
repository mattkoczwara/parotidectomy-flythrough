import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESECTION_EXTENT } from '@atlas/timeline';

/**
 * Gland volume taken by each operation in the model, from the piece volumes the anatomy pipeline measured
 * (frame.json `pieces`, written by `npm run anatomy`) and the shared extent table. The tumour travels inside its
 * cuff, so only gland pieces are summed.
 */
interface Pieces {
  total_gland_ml: number;
  [piece: string]: { volume_ml: number; share: number } | number;
}

export const operations = ['ecd', 'partial', 'superficial', 'total'] as const;
export type Operation = (typeof operations)[number];

export function loadExtents() {
  const frame = JSON.parse(readFileSync(resolve('public/assets/anatomy/frame.json'), 'utf8')) as { pieces: Pieces };
  const pieces = frame.pieces;
  const volume = (id: string) => {
    const p = pieces[id];
    return typeof p === 'object' ? p.volume_ml : 0;
  };
  const bodyTotal = ['parotid_level_1', 'parotid_level_2', 'parotid_ecd_cuff', 'parotid_level_3', 'parotid_level_4'].reduce((s, id) => s + volume(id), 0);
  const rows = Object.fromEntries(
    operations.map((op) => {
      const ids = [...RESECTION_EXTENT[op].out, ...RESECTION_EXTENT[op].deep];
      const ml = ids.reduce((s, id) => s + volume(id), 0);
      return [op, { ml, share: ml / bodyTotal, pieces: ids.filter((id) => id !== 'pleomorphic_adenoma') }];
    }),
  ) as Record<Operation, { ml: number; share: number; pieces: string[] }>;
  return { rows, bodyTotal, maskTotal: pieces.total_gland_ml };
}
