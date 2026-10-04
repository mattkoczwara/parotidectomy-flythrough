/*
 * Renders for plate 54, "Four operations on the same gland": the real model with each resection applied and its
 * specimen part-way out of the field, written to apps/site/public/compare/<operation>.png (640x480). The pictures use
 * the scene the narrative uses (same pieces, same poses), so the extents they show are the ones the stage moves.
 * Needs the dev server (the patch hook is development-only):
 *
 *   node tools/capture/compare.mjs [--url http://localhost:4321]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:4321';
const here = import.meta.dirname;
const outDir = resolve(here, '../../apps/site/public/compare');
const work = resolve(here, 'output/compare');
mkdirSync(outDir, { recursive: true });

const hide = Object.fromEntries(['skin', 'eyes', 'skull', 'subcutaneous_fat', 'smas', 'parotid_fascia', 'temporalis_r', 'parotid_duct', 'parotid_accessory_lobe', 'sternocleidomastoid_r'].map((id) => [id, { presence: 0 }]));
const operations = {
  ecd: { peel: 0, deep: 0, mobilise: 0 },
  partial: { peel: 1, deep: 0, mobilise: 0 },
  superficial: { peel: 1, deep: 0, mobilise: 0 },
  total: { peel: 1, deep: 0.6, mobilise: 1 },
};

for (const [name, op] of Object.entries(operations)) {
  const patch = {
    variantMix: { resection: { [name]: 1 } },
    op: { ...op, out: 0.55, explode: 0, flap: 0, ink_plane: 0, ink_cranial: 0, ink_cuff: 0 },
    camera: { azimuth: -50, elevation: 28, zoom: 0.8, frame: ['specimen@0.55', 'parotid_deep_lobe'] },
    structures: {
      ...hide,
      mandible: { presence: 1, mode: 'ghost', opacity: 0.35, emphasis: 'context' },
      masseter_r: { presence: 1, mode: 'ghost', opacity: 0.35, emphasis: 'context' },
      facial_nerve: { presence: 1, mode: 'solid', opacity: 1, emphasis: 'focus' },
    },
  };
  const dir = join(work, name);
  const r = spawnSync(process.execPath, [join(here, 'snap.mjs'), 'compare', '--url', url, '--out', dir, '--w', '640', '--h', '480', '--clean', '--patch', JSON.stringify(patch)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  copyFileSync(join(dir, 'compare.png'), join(outDir, `${name}.png`));
  console.log(`wrote ${name}.png`);
}
