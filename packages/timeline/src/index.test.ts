import { describe, expect, it } from 'vitest';
import { compile, evaluate, GLAND_PIECES, positionAt, RESECTION_EXTENT, restingY, scrollYAt, shouldDissolve, type PlateSpec } from './index.ts';

const specs: PlateSpec[] = [
  {
    id: 'face',
    delta: {
      camera: { azimuth: 0, elevation: 5, zoom: 1, frame: ['skin'] },
      structures: { skin: { emphasis: 'focus' }, parotid: { presence: 0 } },
      labels: [{ structureId: 'skin' }],
    },
  },
  {
    id: 'where-parotid',
    delta: {
      camera: { frame: ['parotid'] },
      structures: { skin: { mode: 'ghost', opacity: 0.2, emphasis: 'context' }, parotid: { presence: 1, emphasis: 'focus' } },
      labels: [{ structureId: 'parotid' }, { structureId: 'masseter', priority: 2 }],
    },
    transition: { camera: [0, 0.5], structures: [0.5, 1] },
  },
  {
    id: 'peel',
    delta: { camera: { azimuth: 350 }, op: { peel: 0.6, ink: 1 }, variants: { resection: 'superficial' } },
    transition: { op: [0, 0.5], opKeys: { ink: [0.5, 1] } },
  },
];
const track = compile(specs);

describe('compile', () => {
  it('produces absolute plateau states from deltas', () => {
    expect(track.plates[2]!.structures.skin).toEqual({ presence: 1, opacity: 0.2, mode: 'ghost', emphasis: 'context' });
    expect(track.plates[2]!.labels.map((l) => l.structureId)).toEqual(['parotid', 'masseter']);
  });

  it('rejects duplicate ids and invalid windows', () => {
    expect(() => compile([specs[0]!, specs[0]!])).toThrow(/duplicate/);
    expect(() => compile([{ id: 'x', delta: {}, transition: { camera: [0.6, 0.2] } }])).toThrow(/invalid/);
  });
});

describe('evaluate', () => {
  it('returns plateau states exactly at integer t', () => {
    expect(evaluate(track, 1)).toBe(track.plates[1]);
  });

  it('is a pure function of t (forward and backward scrubs agree)', () => {
    const forward = [0, 0.3, 0.7, 1.2, 1.4].map((t) => evaluate(track, t));
    const backward = [1.4, 1.2, 0.7, 0.3, 0].map((t) => evaluate(track, t)).reverse();
    expect(forward).toEqual(backward);
  });

  it('gives named operative keys their own windows', () => {
    const mid = evaluate(track, 1.5);
    expect(mid.op['peel']).toBe(0.6);
    expect(mid.op['ink']).toBe(0);
    expect(evaluate(track, 1.75).op['ink']).toBeCloseTo(0.5);
    expect(() => compile([{ id: 'x', delta: {}, transition: { opKeys: { ink: [0.8, 0.2] } } }])).toThrow(/opKeys.ink/);
  });

  it('honours staged windows: camera first, then reveal', () => {
    const early = evaluate(track, 0.4);
    expect(early.structures.parotid!.presence).toBe(0);
    expect(early.camera.frames.find((f) => f.ids[0] === 'parotid')!.weight).toBeGreaterThan(0.5);
    const late = evaluate(track, 0.9);
    expect(late.camera.frames).toHaveLength(2);
    expect(late.camera.frames[1]!.weight).toBe(1);
    expect(late.structures.parotid!.presence).toBeGreaterThan(0.5);
  });

  it('switches enums at the window midpoint and fades labels', () => {
    expect(evaluate(track, 0.7).structures.skin!.mode).toBe('solid');
    expect(evaluate(track, 0.8).structures.skin!.mode).toBe('ghost');
    const mid = evaluate(track, 0.8).labels;
    expect(mid.find((l) => l.structureId === 'skin')!.weight).toBeLessThan(1);
    expect(mid.find((l) => l.structureId === 'parotid')!.weight).toBeGreaterThan(0);
  });

  it('interpolates azimuth along the shortest arc', () => {
    expect(evaluate(track, 1.5).camera.azimuth).toBeCloseTo(-5);
  });

  it('clamps out-of-range and non-finite t', () => {
    expect(evaluate(track, -3)).toBe(track.plates[0]);
    expect(evaluate(track, 99)).toBe(track.plates[2]);
    expect(evaluate(track, Number.NaN)).toBe(track.plates[0]);
  });
});

describe('variants and groups', () => {
  const variantTrack = compile([
    { id: 'a', delta: { variants: { resection: 'ecd' }, op: { peel: 0 } } },
    { id: 'b', delta: { variants: { resection: 'partial' }, op: { peel: 1 } }, transition: { op: [0.2, 0.8], opKeys: { variants: [0, 1] } } },
  ]);
  it('cross-fades variants as weights that always sum to one', () => {
    expect(evaluate(variantTrack, 0).variantMix).toEqual({ resection: { ecd: 1 } });
    expect(evaluate(variantTrack, 1).variantMix).toEqual({ resection: { partial: 1 } });
    const mid = evaluate(variantTrack, 0.5);
    expect(mid.variantMix['resection']).toEqual({ ecd: 0.5, partial: 0.5 });
    expect(mid.variants['resection']).toBe('partial');
    for (const t of [0.1, 0.33, 0.9]) {
      const w = Object.values(evaluate(variantTrack, t).variantMix['resection']!);
      expect(w.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    }
  });
  it('keeps the variant mix a pure function of t', () => {
    const ts = [0.9, 0.5, 0.1];
    expect(ts.map((t) => evaluate(variantTrack, t)).reverse()).toEqual([0.1, 0.5, 0.9].map((t) => evaluate(variantTrack, t)));
  });
  it('expands a group patch onto its members, a named member winning', () => {
    const grouped = compile(
      [
        { id: 'a', delta: { structures: { lobe: { emphasis: 'focus', opacity: 0.4 }, level2: { opacity: 0.9 } } } },
        { id: 'b', delta: { structures: { lobe: { presence: 0 } } } },
      ],
      undefined,
      { groups: { lobe: ['level1', 'level2'], gland: ['lobe', 'deep'] } },
    );
    expect(grouped.plates[0]!.structures['level1']).toMatchObject({ emphasis: 'focus', opacity: 0.4 });
    expect(grouped.plates[0]!.structures['level2']).toMatchObject({ emphasis: 'focus', opacity: 0.9 });
    expect(grouped.plates[1]!.structures['level2']).toMatchObject({ presence: 0, opacity: 0.9 });
    const nested = compile([{ id: 'a', delta: { structures: { gland: { presence: 0.5 } } } }], undefined, { groups: { lobe: ['level1'], gland: ['lobe', 'deep'] } });
    expect(Object.keys(nested.plates[0]!.structures).sort()).toEqual(['deep', 'level1']);
  });
});

describe('shouldDissolve', () => {
  it('dissolves long jumps and always under reduced motion', () => {
    expect(shouldDissolve(1, 2, false)).toBe(false);
    expect(shouldDissolve(1, 4, false)).toBe(true);
    expect(shouldDissolve(1, 2, true)).toBe(true);
    expect(shouldDissolve(2, 2, true)).toBe(false);
  });
});

describe('scroll mapping', () => {
  const bands = [
    { plateauStart: 100, plateauEnd: 400 },
    { plateauStart: 1000, plateauEnd: 1300 },
    { plateauStart: 2000, plateauEnd: 2200 },
  ];
  it('holds t on plateaus and interpolates across spacers', () => {
    expect(positionAt(0, bands)).toBe(0);
    expect(positionAt(250, bands)).toBe(0);
    expect(positionAt(700, bands)).toBeCloseTo(0.5);
    expect(positionAt(1200, bands)).toBe(1);
    expect(positionAt(1650, bands)).toBeCloseTo(1.5);
    expect(positionAt(9999, bands)).toBe(2);
  });
  it('rests inside the plateau', () => {
    expect(positionAt(restingY(1, bands), bands)).toBe(1);
    for (const t of [0, 0.25, 0.5, 1, 1.5, 1.9, 2]) expect(positionAt(scrollYAt(t, bands), bands)).toBeCloseTo(t);
  });
});

describe('resection extents', () => {
  it('nest: each operation takes at least what the smaller one takes, and the total adds the inner levels', () => {
    const take = (op: keyof typeof RESECTION_EXTENT) => new Set([...RESECTION_EXTENT[op].out, ...RESECTION_EXTENT[op].deep]);
    const within = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
    expect(within(take('ecd'), take('partial'))).toBe(true);
    expect(within(take('partial'), take('superficial'))).toBe(true);
    expect(within(take('superficial'), take('total'))).toBe(true);
    expect(RESECTION_EXTENT.total.deep).toEqual(['parotid_level_3', 'parotid_level_4']);
    expect(RESECTION_EXTENT.superficial.deep).toEqual([]);
  });
  it('every piece named is a gland piece or the tumour', () => {
    const known = new Set<string>([...GLAND_PIECES, 'pleomorphic_adenoma']);
    for (const e of Object.values(RESECTION_EXTENT)) for (const id of [...e.out, ...e.deep]) expect(known.has(id)).toBe(true);
  });
});
