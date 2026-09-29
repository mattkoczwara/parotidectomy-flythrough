/**
 * Mapping between document scroll and timeline position. Each plate's text crosses a fixed reading line;
 * while it does, t holds at the plate index (the plateau). The spacer between two plates' text is the
 * transition. Native scrolling is never intercepted: this only reads positions.
 */

export interface PlateBand {
  /** Document y (px) at which the plate's text reaches the reading line. */
  plateauStart: number;
  /** Document y (px) at which the plate's text leaves the reading line (transition to the next plate begins). */
  plateauEnd: number;
}

/** Timeline position for the document y currently under the reading line. */
export function positionAt(y: number, bands: readonly PlateBand[]): number {
  if (bands.length === 0) return 0;
  if (y <= bands[0]!.plateauStart) return 0;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    if (y <= band.plateauEnd) return i;
    const next = bands[i + 1];
    if (!next) return i;
    if (y < next.plateauStart) {
      const span = next.plateauStart - band.plateauEnd;
      return span > 0 ? i + (y - band.plateauEnd) / span : i + 1;
    }
  }
  return bands.length - 1;
}

/** Document y to put under the reading line to rest on plate i (deep links, keyboard navigation). */
export function restingY(i: number, bands: readonly PlateBand[]): number {
  const band = bands[Math.min(Math.max(i, 0), bands.length - 1)];
  if (!band) return 0;
  return band.plateauStart + Math.min(24, (band.plateauEnd - band.plateauStart) / 2);
}

/** Document y for timeline position t (the inverse of positionAt, for scrubbing tools): plateaus rest as in
 *  restingY; fractional t lies proportionally within the spacer after plate floor(t). */
export function scrollYAt(t: number, bands: readonly PlateBand[]): number {
  if (bands.length === 0) return 0;
  const tc = Math.min(Math.max(t, 0), bands.length - 1);
  const i = Math.floor(tc);
  const f = tc - i;
  if (f === 0 || i === bands.length - 1) return restingY(i, bands);
  const a = bands[i]!.plateauEnd;
  const b = bands[i + 1]!.plateauStart;
  return a + (b - a) * f;
}
