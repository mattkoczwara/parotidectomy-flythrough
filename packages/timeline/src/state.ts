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
  /** Discrete choices (incision variant, resection variant, …). */
  variants: Readonly<Record<string, string>>;
  labels: readonly LabelState[];
  light: { preset: LightPreset; exposure: number };
}

/** What a plate author writes: only the fields that change relative to the previous plate. */
export interface PlateDelta {
  camera?: Partial<Omit<CameraState, 'frames'>> & { frame?: readonly string[] };
  structures?: Readonly<Record<string, Partial<StructureState>>>;
  gauge?: number;
  op?: Readonly<Record<string, number>>;
  variants?: Readonly<Record<string, string>>;
  /** Replaces the label set; omitted = keep the previous plate's labels. */
  labels?: ReadonlyArray<{ structureId: string; priority?: number }>;
  light?: Partial<SceneState['light']>;
}

/**
 * Transition into a plate, as windows within [0, 1] of the spacer before it. Large camera moves and
 * reveals should not overlap ("camera first, then reveal").
 */
export interface TransitionSpec {
  camera?: readonly [number, number];
  structures?: readonly [number, number];
  op?: readonly [number, number];
  labels?: readonly [number, number];
}

export interface PlateSpec {
  id: string;
  delta: PlateDelta;
  transition?: TransitionSpec;
}

export const defaultStructure: StructureState = { presence: 1, opacity: 1, mode: 'solid', emphasis: 'context' };
