/**
 * Rendering layer (three.js r186 WebGPURenderer with WebGL2 fallback; ADR-0001). Resolves SceneState from
 * @atlas/timeline onto the anatomy glTF produced by pipeline/build (ADR-0002 frame).
 */
export { Stage, type AnchorProjection, type StageOptions, type StructureInfo, type Tier } from './stage.ts';
export type { TissueFamily } from './materials.ts';
