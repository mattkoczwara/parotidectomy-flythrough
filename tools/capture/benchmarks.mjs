/*
 * Approved visual benchmarks (the final presentation pass, docs/benchmarks/README.md): the hero states are captured
 * with snap.mjs (capture mode: deterministic settled picture, centred subject, no overlays) and compared with the
 * approved pictures. A later change must not degrade an approved benchmark merely to improve another scene.
 * Needs the dev server.
 *
 *   node tools/capture/benchmarks.mjs                 compare every benchmark with its approved picture
 *   node tools/capture/benchmarks.mjs --approve face  capture and approve (replace) the named benchmarks
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

/** Benchmark id → plate id (and optional view patch for snap.mjs). */
const BENCHMARKS = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../docs/benchmarks/benchmarks.json'), 'utf8'));
const args = process.argv.slice(2);
const approve = args.includes('--approve');
const only = args.filter((a) => !a.startsWith('--'));
const dir = resolve(import.meta.dirname, '../../docs/benchmarks');
const work = resolve(import.meta.dirname, 'output/benchmarks');
mkdirSync(work, { recursive: true });
const W = 1600;
const H = 1000;

const results = [];
for (const [id, b] of Object.entries(BENCHMARKS)) {
  if (only.length && !only.includes(id)) continue;
  const snapArgs = [join(import.meta.dirname, 'snap.mjs'), b.plate, '--w', String(W), '--h', String(H), '--out', join(work, id)];
  if (b.patch) snapArgs.push('--patch', JSON.stringify(b.patch));
  const r = spawnSync(process.execPath, snapArgs, { encoding: 'utf8' });
  const png = join(work, id, `${b.plate}.png`);
  if (r.status !== 0 || !existsSync(png)) {
    console.log(`${id}: capture failed\n${r.stdout}${r.stderr}`);
    continue;
  }
  const approved = join(dir, `${id}.webp`);
  if (approve) {
    await sharp(png).webp({ quality: 90 }).toFile(approved);
    console.log(`${id}: approved -> docs/benchmarks/${id}.webp`);
    continue;
  }
  if (!existsSync(approved)) {
    console.log(`${id}: no approved picture`);
    continue;
  }
  const [a, c] = await Promise.all([sharp(approved).removeAlpha().raw().toBuffer(), sharp(png).removeAlpha().raw().toBuffer()]);
  let differ = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.max(Math.abs(a[i] - c[i]), Math.abs(a[i + 1] - c[i + 1]), Math.abs(a[i + 2] - c[i + 2]));
    sum += d;
    if (d > 12) differ++;
  }
  const n = a.length / 3;
  const res = { id, differingPct: +((differ / n) * 100).toFixed(2), meanDelta: +(sum / n).toFixed(2) };
  results.push(res);
  console.log(`${id}: ${res.differingPct}% of pixels differ by more than 12/255, mean delta ${res.meanDelta}`);
}
if (results.length) writeFileSync(join(work, 'report.json'), JSON.stringify(results, null, 2));
