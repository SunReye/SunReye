// The scene's finishes (ADR 20 Look): a white-box model. Everything built is matte clay in a few
// flat tones, so its form comes from the light alone; only the modules' dark glass and the panes
// reflect. Two maps are generated in code, a module's cells and the light a lit opening spills.
import {
  AdditiveBlending,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  ShaderChunk,
  SRGBColorSpace,
} from "three";
import type { FenceFinish, GroundFinish } from "../builder/pv.ts";
import { GROUPS, type GroupName, type Pixels } from "./pixels.ts";
import { warmed } from "./warm.ts";

const textures = new Map<string, DataTexture>();

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js uploads the pixels as they are.
function texture(key: string, pixels: Pixels): DataTexture {
  const made = new DataTexture(pixels.data, pixels.w, pixels.h);

  // The albedo is colour; roughness and a module's glow mask are data.
  made.colorSpace = key.endsWith(".map") ? SRGBColorSpace : NoColorSpace;
  made.wrapS = made.wrapT = RepeatWrapping;
  made.magFilter = LinearFilter;
  made.minFilter = LinearMipmapLinearFilter;
  made.generateMipmaps = true;
  made.anisotropy = 8;
  made.needsUpdate = true;

  return made;
}

/** One map of a group: the warm-up worker's, or generated here on first use. */
function map(name: GroupName, kind: string): DataTexture {
  const key = `${name}.${kind}`;
  const cached = textures.get(key);

  if (cached !== undefined) return cached;

  for (const [made, pixels] of Object.entries<Pixels>(warmed[name] ?? GROUPS[name]())) {
    textures.set(made, texture(made, pixels));
  }

  const generated = textures.get(key);

  if (generated === undefined) throw new Error(`no map ${key}`);

  return generated;
}

/** The model's clay tones. None is white: the tone mapping keeps a sunlit face under the page's
 * white, and a shaded one well apart from it. */
export const TONE = {
  /** Walls, chimneys, obstacles, posts and frames: matte off-white. */
  clay: 0xe6e3dd,
  /** Roof faces: a cooler light grey, so a roof reads against its walls. */
  roof: 0xc9cdd2,
  /** The studio floor. */
  floor: 0xcfd1d4,
  /** Crowns and hedges: clay with a breath of green. */
  foliage: 0xc6cdbd,
  /** Trunks and wooden fences: clay with a breath of wood. */
  wood: 0xd3c9ba,
  /** Metal fences and door leaves: a darker grey. */
  metal: 0x9da1a6,
} as const;

/** How much stronger glass mirrors the sky than the sky lights the clay: the sky model is kept
 * dim as a light (light.ts), and would leave the glass blank. */
const GLASS = 3;

/** Matte, with no map: `tone`, or a block's own colour as a flat tint. */
function matte(tone: number, colour?: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: colour ?? tone, roughness: 0.92, metalness: 0 });
}

/** Clay: walls in a block's wall colour, chimneys, obstacles, poles and wall fences. */
export const clay = (colour?: string): MeshStandardMaterial => matte(TONE.clay, colour);

/** A roof face, pitched or flat, in its block's roof colour. */
export const roofing = (colour?: string): MeshStandardMaterial => matte(TONE.roof, colour);

/** A crown or a hedge. */
export const foliage = (): MeshStandardMaterial => matte(TONE.foliage);

/** A tree's trunk. */
export const trunk = (): MeshStandardMaterial => matte(TONE.wood);

/** The studio floor the plot stands on. */
export const floor = (): MeshStandardMaterial => matte(TONE.floor);

/** Ground surfaces: flat greys a step apart from the floor and from each other. */
const GROUND_TONE: Readonly<Record<GroundFinish, number>> = {
  lawn: 0xb2b6b0,
  paving: 0xdcdddd,
  driveway: 0xacadaf,
  gravel: 0xc4c4c1,
  path: 0xd6d5d2,
};

export const GROUND: Readonly<Record<GroundFinish, () => MeshStandardMaterial>> = {
  lawn: () => matte(GROUND_TONE.lawn),
  paving: () => matte(GROUND_TONE.paving),
  driveway: () => matte(GROUND_TONE.driveway),
  gravel: () => matte(GROUND_TONE.gravel),
  path: () => matte(GROUND_TONE.path),
};

/** Fences: boards, bars, a wall. */
export const FENCE: Readonly<Record<FenceFinish, () => MeshStandardMaterial>> = {
  wood: () => matte(TONE.wood),
  metal: () => matte(TONE.metal),
  wall: () => clay(),
};

/** A wall-hung box: inverter or battery. */
export function equipment(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4, metalness: 0.05 });
}

/**
 * A full-black module: black cells and backsheet under glass that mirrors the sky. Its emissive
 * lights the cells only.
 */
export function module(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map: map("module", "map"),
    roughnessMap: map("module", "rough"),
    roughness: 0.5,
    metalness: 0,
    // Low, so the sun and the moon leave no glare on the cells; the sky still mirrors.
    specularIntensity: 0.2,
    envMapIntensity: GLASS * 2.5,
    emissiveMap: map("module", "glow"),
    emissiveIntensity: 0,
    // Pulled toward the camera, so a module on its roof never flickers through it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** A pane: dark glass that mirrors the sky by day; its emissive is a lit room's glow, out until
 * the lamps come on. */
export function darkGlass(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0x151b22,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: GLASS,
    emissive: 0xffc478,
    emissiveIntensity: 0,
  });
}

/** Existing PV: a matte near-black field, apart from the plant's own mirroring modules. */
export const existingField = (): MeshStandardMaterial => matte(0x2a2f36);

/** A door's leaf: a darker grey than its frame. */
export const leaf = (): MeshStandardMaterial => matte(TONE.metal);

/** Light on the ground from a lit opening: added to what lies there, each patch at the strength
 * in its vertex colours, and out by day. */
export function spilled(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map: map("spill", "map"),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });

  // The landing already carries the fog colour. The additive decal contributes light alone.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      ShaderChunk.fog_fragment.replace("fogColor", "vec3(0.0)"),
    );
  };

  return material;
}
