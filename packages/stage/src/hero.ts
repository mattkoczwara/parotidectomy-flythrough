import * as THREE from 'three/webgpu';
import { U } from './materials.ts';
import { attribute, cameraPosition, cross, dot, float, fract, max, mix, normalLocal, normalMap, normalize, positionLocal, screenCoordinate, smoothstep, texture, transformNormalToView, uniform, uv, vec2, vec3 } from 'three/tsl';

/**
 * The opening's hero portrait (pipeline/blender/hero.py; presentation only, no claims): a separate asset drawn while
 * the opening shows, which hands off to the fitted exterior before any anatomy appears (ADR-0005, opening hero).
 *
 * The handoff, driven by the portrait weight p (U.portrait, 1 on the opening, 0 once the exterior is the donor's):
 * the hero morphs onto the fitted surface along its baked `_hdisp` (p 1 → 0.35) and its skin dissolves pixel by pixel
 * over the fitted skin, which it now coincides with (p 0.3 → 0). Its hair rides the scalp throughout and stays as the
 * opening's haircut until the skin is ghosted. The dissolve's pattern changes with the TRAA jitter, so a settled frame resolves it.
 */
export const H = {
  /** hero → fitted shape, 0..1 */
  morph: uniform(0),
  /** skin and eyes present, 0..1 (dithered) */
  skin: uniform(1),
  /** hair present, 0..1 (strand by strand) */
  hair: uniform(1),
  /** frame phase of the dissolve's pattern (the TRAA jitter index) */
  frame: uniform(0),
  /** world size of one pixel per metre of distance (2 tan(fov/2) / drawing-buffer height): the strands' minimum width */
  pixel: uniform(0.001),
};

/** The handoff's weights from the portrait weight p (see above). The hair is not among them: the hero's groom stays
 *  on through the handoff and dissolves with the skin's ghosting, as the fitted haircut would (stage.ts). */
export function handoff(p: number) {
  const s = THREE.MathUtils.smoothstep;
  return { morph: 1 - s(p, 0.35, 1), skin: s(p, 0, 0.3) };
}

/** A per-pixel threshold that moves with the frame phase (interleaved gradient noise, Jimenez 2014). */
const dither = () => {
  const q = screenCoordinate.xy.floor().add(vec2(H.frame.mul(5.588238), H.frame.mul(5.588238)));
  return fract(fract(dot(q, vec2(0.06711056, 0.00583715))).mul(52.9829189));
};

/** Rest position along the morph. Toward its end the hero lies on the fitted surface, but its flat triangles cross
 *  the fitted ones; a lift of about a millimetre along the normal keeps it in front, so the dissolve shows one
 *  surface or the other, never z-fighting patches. */
const rest = (g: THREE.BufferGeometry, lift = true) =>
  g.getAttribute('_hdisp')
    ? positionLocal.add(attribute('_hdisp', 'vec3').mul(H.morph)).add(lift ? normalLocal.mul(H.morph.mul(0.0011)) : vec3(0, 0, 0))
    : positionLocal;

const srgb = (hex: number) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};

export interface HeroPart {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalNodeMaterial;
}

/** The hero's baked skin maps (skin.py): albedo (sRGB), tangent-space normal, and ORM (R occlusion, G roughness,
 *  B thickness for the subsurface term). */
export interface HeroMaps {
  albedo: THREE.Texture;
  /** the same skin in the fitted exterior's tone, without the beard: what the hero settles into */
  albedoFit: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
}

export async function loadHeroMaps(dir: string, anisotropy: number): Promise<HeroMaps | null> {
  const loader = new THREE.TextureLoader();
  try {
    const [albedo, albedoFit, normal, orm] = await Promise.all(['albedo', 'albedo_fit', 'normal', 'orm'].map((k) => loader.loadAsync(`${dir}hero_${k}.webp`)));
    for (const t of [albedo!, albedoFit!, normal!, orm!]) {
      t.flipY = false; // glTF texture coordinates
      t.anisotropy = anisotropy;
      t.colorSpace = THREE.NoColorSpace;
    }
    albedo!.colorSpace = THREE.SRGBColorSpace;
    albedoFit!.colorSpace = THREE.SRGBColorSpace;
    return { albedo: albedo!, albedoFit: albedoFit!, normal: normal!, orm: orm! };
  } catch {
    return null;
  }
}

/** How much of the hero's skin is present: all of it with the portrait, then the scalp under the groom (it dissolves
 *  with the haircut, not with the face). */
const skinPresence = (g: THREE.BufferGeometry) =>
  g.getAttribute('_scalp') ? max(H.skin, smoothstep(0.2, 0.6, attribute('_scalp', 'float')).mul(H.hair)) : H.skin;

/**
 * The hero's skin: the baked maps under a restrained subsurface term. `fade`: the dissolve's variant, a true
 * crossfade over the fitted skin (drawn in the transparent pass over `heroDepth`'s depth, so only the hero's front
 * surface blends); the opaque variant draws the opening itself, where the hero alone is in the depth pre-pass.
 */
export function heroSkin(g: THREE.BufferGeometry, maps: HeroMaps | null, fade = false): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshSSSNodeMaterial();
  m.positionNode = rest(g);
  const orm = maps ? texture(maps.orm, uv()) : null;
  // a portrait light, not a flood: the body below the jaw falls into shade (glTF metres; the origin is the parotid's
  // centroid, about 4 cm below the eyes)
  const away = smoothstep(-0.08, -0.3, positionLocal.y);
  if (maps && orm) {
    // (as the hero settles onto the fitted surface, its colour, micro-relief and occlusion ease toward the fitted
    // skin's tone and smoother shading, so the dissolve shows no change of tone or texture)
    const settle = H.morph.mul(H.morph);
    const tone = mix(texture(maps.albedo, uv()).rgb, texture(maps.albedoFit, uv()).rgb, settle);
    m.colorNode = tone.mul(float(1).sub(away.mul(0.68).mul(float(1).sub(settle))));
    m.normalNode = normalMap(texture(maps.normal, uv()), vec2(float(1).sub(settle.mul(0.75))));
    m.roughnessNode = mix(orm.g.add(away.mul(0.2)), float(0.5), settle.mul(0.6));
    m.aoNode = mix(orm.r, float(1), settle.mul(0.6));
  } else {
    m.colorNode = srgb(0xc29a86);
    m.roughness = 0.5;
  }
  // a sharper second specular lobe over the broad one: the sheen of skin oil
  // (on the face and neck only: across the shoulders it flooded the body with the key's reflection)
  m.clearcoatNode = float(0.35).mul(float(1).sub(smoothstep(-0.05, -0.2, positionLocal.y)));
  m.clearcoatRoughness = 0.3;
  // the opening's outline of the gland on the skin (the fitted skin's field, carried over by the handoff): a fine
  // warm-white line and a slight warm shift inside it, as the fitted skin draws it (materials.ts `locate`)
  if (g.getAttribute('_foot')) {
    const foot = attribute('_foot', 'float');
    const c = m.colorNode as THREE.Node<'vec3'>;
    const warm = mix(c, c.mul(vec3(1.05, 0.9, 0.84)), smoothstep(-1.5, 3, foot).mul(U.locate).mul(0.3));
    m.colorNode = mix(warm, srgb(0xf7f2e9), float(1).sub(smoothstep(0.16, 0.5, foot.abs())).mul(U.locate).mul(0.6));
  }
  m.thicknessColorNode = srgb(0x8a5e50);
  m.thicknessDistortionNode = float(0.15);
  m.thicknessAmbientNode = float(0.03);
  m.thicknessAttenuationNode = float(0.6);
  m.thicknessPowerNode = float(3.0);
  // (only the thin parts: a baseline let the strong rim behind the figure glow through the neck and shoulders)
  m.thicknessScaleNode = orm ? orm.b.mul(0.4) : float(0.1);
  if (fade) {
    m.transparent = true;
    m.depthWrite = false;
    m.opacityNode = skinPresence(g);
  }
  // ahead of the fitted skin it coincides with at the end of the morph
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  return m;
}

/** Depth only, for the dissolve: the hero's nearest surface, written after the fitted skin (transparent pass, drawn
 *  first), so the crossfade blends one layer of the hero over the fitted skin and never its own back folds. */
export function heroDepth(g: THREE.BufferGeometry): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.positionNode = rest(g);
  m.colorWrite = false;
  m.transparent = true;
  m.depthWrite = true;
  m.maskNode = skinPresence(g).greaterThan(0.003);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  return m;
}

/** The hero's eyes: sclera, iris and pupil from the direction to each globe's centre (they look ahead, glTF +Z). */
export function heroEyes(g: THREE.BufferGeometry): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  g.computeBoundingBox();
  const p = g.getAttribute('position');
  const mid = (g.boundingBox!.min.x + g.boundingBox!.max.x) / 2;
  const c = [new THREE.Vector3(), new THREE.Vector3()];
  const n = [0, 0];
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i) < mid ? 0 : 1;
    c[k]!.add(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    n[k]!++;
  }
  c[0]!.divideScalar(n[0]!);
  c[1]!.divideScalar(n[1]!);
  const pos = attribute('position', 'vec3');
  const centre = pos.x.lessThan(mid).select(vec3(c[0]!.x, c[0]!.y, c[0]!.z), vec3(c[1]!.x, c[1]!.y, c[1]!.z));
  const dirZ = pos.sub(centre).normalize().z;
  const iris = smoothstep(0.8, 0.83, dirZ);
  const pupil = smoothstep(0.955, 0.965, dirZ);
  const limbus = smoothstep(0.79, 0.82, dirZ).mul(smoothstep(0.86, 0.82, dirZ));
  m.positionNode = rest(g, false);
  m.colorNode = mix(mix(srgb(0xd9d1c6), srgb(0x5e4636), iris), srgb(0x141010), pupil).mul(float(1).sub(limbus.mul(0.35)));
  m.roughness = 0.25;
  m.clearcoat = 0.6;
  m.clearcoatRoughness = 0.12;
  m.maskNode = dither().lessThan(H.skin);
  return m;
}

/**
 * The hero's hair (groom.py): one ribbon per strand, two vertices per point (`_hair` = t root→tip, side ±1, width mm;
 * `_hrnd` = strand random, kind 0 scalp / 1 brow, occlusion). The vertex stage turns each segment toward the camera
 * and keeps it at least about a pixel wide (TRAA resolves the coverage). Shading: a pseudo-cylinder normal across the
 * ribbon bent toward the scalp normal at the root, an anisotropic highlight along the strand, darker roots and inner
 * layers, a lighter, warmer tip, and a tone per strand. Dissolves strand by strand with H.hair.
 */
export function heroHair(g: THREE.BufferGeometry): THREE.MeshPhysicalNodeMaterial {
  // the strand tangent as the anisotropy frame
  const flowA = g.getAttribute('_flow');
  const tangent = new Float32Array(flowA.count * 4);
  for (let i = 0; i < flowA.count; i++) tangent.set([flowA.getX(i), flowA.getY(i), flowA.getZ(i), 1], i * 4);
  g.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const h = attribute('_hair', 'vec3');
  const r = attribute('_hrnd', 'vec3');
  const t = h.x;
  const side = h.y;
  const flow = normalize(attribute('_flow', 'vec3'));
  // (riding the scalp through the morph, the strands lift a little off it: the fitted head is fuller, and flat side
  // hair sank under the moving surface)
  const base = rest(g, false).add(attribute('_hairn', 'vec3').mul(H.morph.mul(0.0024)));
  const toCam = cameraPosition.sub(base);
  const dist = toCam.length();
  const view = toCam.div(dist);
  const across = normalize(cross(flow, view));
  const width = max(h.z.mul(0.001), dist.mul(H.pixel).mul(0.8));
  m.positionNode = base.add(across.mul(side.mul(width).mul(0.5)));
  const facing = normalize(view.sub(flow.mul(dot(view, flow))));
  const cyl = normalize(facing.add(across.mul(side.mul(0.9))));
  const n = normalize(mix(attribute('_hairn', 'vec3'), cyl, float(0.35).add(t.mul(0.4))));
  m.normalNode = transformNormalToView(n);
  const rnd = r.x;
  const brow = r.y;
  const ao = r.z;
  // near-neutral albedos: the Neutral tone mapping's toe saturates dark colours (memory: opening-portrait)
  // (a little blue in the albedo offsets the warm lights and the tone curve's toe, which saturates dark colours)
  const root = mix(srgb(0x17181c), srgb(0x1c1c20), rnd);
  const tip = mix(srgb(0x232224), srgb(0x29272a), fract(rnd.mul(7.31)));
  const col = mix(root, tip, smoothstep(0.1, 1.0, t).mul(0.8));
  const shade = mix(float(0.12), float(1), ao.pow(1.4)).mul(float(0.8).add(fract(rnd.mul(13.7)).mul(0.4)));
  // brows (kind 1) a dark brown; lashes (kind 2) near black
  m.colorNode = mix(mix(col.mul(shade), srgb(0x45392f).mul(float(0.75).add(ao.mul(0.25))), brow.min(1)), srgb(0x141212), brow.sub(1).max(0));
  m.roughness = 0.42;
  m.anisotropy = 0.85;
  m.specularIntensity = 0.45;
  m.sheen = 0.18;
  m.sheenRoughness = 0.45;
  m.sheenColor = new THREE.Color(0x3c3c40);
  m.maskNode = rnd.lessThan(H.hair);
  return m;
}
