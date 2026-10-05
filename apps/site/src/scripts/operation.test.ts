import { describe, expect, it } from 'vitest';
import type { SceneState } from '@atlas/timeline';
import { applyOperation, type OperationControls } from './operation.ts';

const base = (): SceneState => ({ camera: { azimuth: 0, elevation: 0, zoom: 1, frames: [] }, structures: {}, gauge: 0, op: {}, variants: {}, variantMix: {}, labels: [], light: { preset: 'studio', exposure: 1, mix: { studio: 1 } } });
const controls = (over: Partial<OperationControls> = {}): OperationControls => ({ active: true, resection: 'superficial', incision: 'blair', barrier: 'none', progress: 0, ...over });
const at = (progress: number, over: Partial<OperationControls> = {}) => applyOperation(base(), controls({ progress, ...over })).op;

describe('applyOperation', () => {
  it('leaves the authored scene alone until a control is touched', () => {
    const s = base();
    expect(applyOperation(s, controls({ active: false, progress: 90 }))).toBe(s);
    expect(s.op['peel']).toBeUndefined();
  });

  it('does not change the authored state it is given (the timeline caches it, and the reset returns to it)', () => {
    const s = base();
    const before = JSON.stringify(s);
    const out = applyOperation(s, controls({ resection: 'total', barrier: 'smas', progress: 100 }));
    expect(out).not.toBe(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('selects the resection as a one-hot mix', () => {
    const s = applyOperation(base(), controls({ resection: 'partial' }));
    expect(s.variantMix['resection']).toEqual({ partial: 1 });
    expect(s.variants['resection']).toBe('partial');
  });

  it('carries the operation in the narrative order as the slider moves', () => {
    const early = at(10);
    expect(early['ink']).toBe(1);
    expect(early['flap']).toBeGreaterThan(0);
    expect(early['peel']).toBe(0);
    const mid = at(45);
    expect(mid['peel']).toBeGreaterThan(0.4);
    expect(mid['out']).toBe(0);
    const late = at(80);
    expect(late['peel']).toBe(1);
    expect(late['out']).toBe(1);
    expect(late['deep']).toBe(0);
  });

  it('never leaves the unit interval and never moves backwards as the slider rises', () => {
    for (const res of ['none', 'ecd', 'partial', 'superficial', 'total']) {
      let prev: Record<string, number> = {};
      for (let p = 0; p <= 100; p += 2) {
        const op = at(p, { resection: res });
        for (const k of ['ink', 'flap', 'peel', 'out', 'mobilise', 'deep']) {
          expect(op[k]!, `${res} ${k} @${p}`).toBeGreaterThanOrEqual(0);
          expect(op[k]!, `${res} ${k} @${p}`).toBeLessThanOrEqual(1);
          expect(op[k]!, `${res} ${k} @${p}`).toBeGreaterThanOrEqual(prev[k] ?? 0);
        }
        prev = { ...op } as Record<string, number>;
      }
    }
  });

  it('lifts the specimen out of an extracapsular dissection without a fold, and does nothing for none', () => {
    expect(at(70, { resection: 'ecd' })['peel']).toBe(0);
    expect(at(70, { resection: 'ecd' })['out']).toBe(1);
    expect(at(100, { resection: 'none' })['out']).toBe(0);
  });

  it('draws the inner gland out only in a total parotidectomy, after the nerve is lifted', () => {
    expect(at(100, { resection: 'superficial' })['deep']).toBe(0);
    const total = at(100, { resection: 'total' });
    expect(total['mobilise']).toBe(1);
    expect(total['deep']).toBe(1);
    expect(at(82, { resection: 'total' })['mobilise']).toBeGreaterThan(0);
    expect(at(82, { resection: 'total' })['deep']).toBe(0);
  });

  it('shows the chosen closure layer only once the specimen is out', () => {
    expect(applyOperation(base(), controls({ progress: 50, barrier: 'smas' })).structures['smas_flap']?.presence).toBe(0);
    const closed = applyOperation(base(), controls({ progress: 100, barrier: 'smas' }));
    expect(closed.structures['smas_flap']?.presence).toBeCloseTo(1, 6);
    expect(closed.op['smas']).toBeCloseTo(0, 6);
    expect(applyOperation(base(), controls({ progress: 100, barrier: 'graft' })).structures['barrier_graft']?.presence).toBeCloseTo(1, 6);
    expect(applyOperation(base(), controls({ progress: 100, barrier: 'scm' })).op['scm']).toBeCloseTo(1, 6);
  });

  it('draws the chosen skin line only', () => {
    const f = at(20, { incision: 'facelift' });
    expect(f['ink_facelift']).toBe(1);
    expect(f['ink']).toBe(0);
    const b = at(20, { incision: 'blair' });
    expect(b['ink']).toBe(1);
    expect(b['ink_facelift']).toBe(0);
  });
});
