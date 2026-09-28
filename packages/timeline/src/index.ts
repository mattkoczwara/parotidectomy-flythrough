/**
 * Timeline position: integer values are plate plateaus, fractional values are
 * transitions between consecutive plates. SceneState, compile() and evaluate()
 * arrive in M0/M1; everything here must stay pure and renderer-independent.
 */
export type TimelinePosition = number;

/** Clamp a timeline position to the authored range [0, plateCount - 1]. */
export function clampPosition(t: TimelinePosition, plateCount: number): TimelinePosition {
  if (plateCount <= 0) throw new RangeError('plateCount must be positive');
  return Math.min(Math.max(t, 0), plateCount - 1);
}
