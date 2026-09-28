import { describe, expect, expectTypeOf, it } from 'vitest';
import { step, type Step } from '@atlas/schema';
import { compile, type PlateSpec } from './index.ts';

describe('authored steps are valid timeline plates', () => {
  it('a schema-parsed step compiles as a PlateSpec', () => {
    const parsed: Step = step.parse({
      id: 'where-parotid',
      chapter: 'orientation',
      order: 2,
      title: 'Where the parotid is',
      delta: { camera: { frame: ['parotid_r'] }, structures: { skin: { mode: 'ghost', opacity: 0.2 } } },
      transition: { camera: [0, 0.5], structures: [0.5, 1] },
      sceneDescription: 'The skin is faded so the gland in front of the ear is visible.',
    });
    expectTypeOf(parsed).toExtend<PlateSpec>();
    expect(compile([parsed]).plates[0]!.structures.skin!.opacity).toBe(0.2);
  });
});
