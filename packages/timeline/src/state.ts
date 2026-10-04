/**
 * Semantic scene state. Everything here is renderer-independent: @atlas/stage resolves it into
 * morph weights, uniforms and camera poses. Numbers interpolate; enums switch at the midpoint of
 * their transition window.
 */

export type StructureMode = 'solid' | 'ghost' | 'hatch' | 'illustrative';
export type Emphasis = 'focus' | 'context' | 'dim';
export type LightPreset = 'studio' | 'operative' | 'specimen';

export interface StructureState {
  /** 0 = absent (removed or not yet revealed), 1 = present. */
  presence: number;
  /** Ghosting strength when mode is 'ghost': 1 = opaque. */
  opacity: number;
  mode: StructureMode;
  emphasis: Emphasis;
}

export interface CameraState {
  /** Degrees around the anatomical vertical axis; 0 = straight lateral view of the patient's right side. */
  azimuth: number;
  /** Degrees above the axial plane. */
  elevation: number;
  /** Framing margin multiplier: 1 = targets fill the safe rect. */
  zoom: number;
  /** Structures the camera frames; during a transition both sets are present with their weights. */
  frames: ReadonlyArray<{ ids: readonly string[]; weight: number }>;
}

export interface LabelState {
  structureId: string;
  /** Lower number = more important; the layout drops low-priority labels first. */
  priority: number;
  /** 0..1 fade. Labels are only laid out when a plate has settled. */
  weight: number;
}

export interface SceneState {
  camera: CameraState;
  structures: Readonly<Record<string, StructureState>>;
  /** Exposed plane on the plane gauge, as a fractional index into depthPlanes. */
  gauge: number;
  /** Continuous operative parameters (incision, flap, peel, …), each 0..1 unless documented otherwise. */
  op: Readonly<Record<string, number>>;
  /** Discrete choices (incision variant, resection variant, …): the variant in force, switching at the window midpoint. */
  variants: Readonly<Record<string, string>>;
  /**
   * The same choices as continuous weights, so a renderer can move between variants without a pop: key → variant →
   * weight. A plateau is one-hot; inside a transition the two variants' weights sum to 1.
   */
  variantMix: Readonly<Record<string, Readonly<Record<string, number>>>>;
  labels: readonly LabelState[];
  light: { preset: LightPreset; exposure: number };
}

/** What a plate author writes: only the fields that change relative to the previous plate. */
type Opt<T> = T | undefined;

export interface PlateDelta {
  camera?: Opt<{ azimuth?: Opt<number>; elevation?: Opt<number>; zoom?: Opt<number>; frame?: Opt<readonly string[]> }>;
  structures?: Opt<Readonly<Record<string, { [K in keyof StructureState]?: Opt<StructureState[K]> }>>>;
  gauge?: Opt<number>;
  op?: Opt<Readonly<Record<string, number>>>;
  variants?: Opt<Readonly<Record<string, string>>>;
  /** Replaces the label set; omitted = keep the previous plate's labels. */
  labels?: Opt<ReadonlyArray<{ structureId: string; priority?: Opt<number> }>>;
  light?: Opt<{ preset?: Opt<LightPreset>; exposure?: Opt<number> }>;
}

/**
 * Transition into a plate, as windows within [0, 1] of the spacer before it. Large camera moves and
 * reveals should not overlap ("camera first, then reveal").
 */
export interface TransitionSpec {
  camera?: Opt<readonly [number, number]>;
  structures?: Opt<readonly [number, number]>;
  op?: Opt<readonly [number, number]>;
  labels?: Opt<readonly [number, number]>;
  /** Per-key windows for operative parameters that must not move together (e.g. ink drawn after windows close). */
  opKeys?: Opt<Readonly<Record<string, readonly [number, number]>>>;
}

export interface PlateSpec {
  id: string;
  delta: PlateDelta;
  transition?: Opt<TransitionSpec>;
}

export const defaultStructure: StructureState = { presence: 1, opacity: 1, mode: 'solid', emphasis: 'context' };
