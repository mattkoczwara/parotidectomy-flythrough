import { describe, expect, it } from 'vitest';
import { clampPosition } from './index.ts';

describe('clampPosition', () => {
  it('keeps positions inside the authored plate range', () => {
    expect(clampPosition(-0.5, 10)).toBe(0);
    expect(clampPosition(4.25, 10)).toBe(4.25);
    expect(clampPosition(12, 10)).toBe(9);
  });

  it('rejects an empty timeline', () => {
    expect(() => clampPosition(0, 0)).toThrow(RangeError);
  });
});
