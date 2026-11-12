// The scene's physically based finishes, every map generated in code (ADR 20 Look). Textures are
// made once and shared; materials are made per build, so disposing a build keeps the textures.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from "three";
import type { FenceFinish, GroundFinish } from "../builder/pv.ts";
import { GROUPS, type GroupName, type Pixels } from "./pixels.ts";
import { warmed } from "./warm.ts";

const textures = new Map<string, DataTexture>();

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js uploads the pixels as they are.
function texture(key: string, pixels: Pixels): DataTexture {
  const made = new DataTexture(pixels.data, pixels.w, pixels.h);

  // Only the albedo is colour; normals, roughness and the glow mask are data.
  made.colorSpace = key.endsWith(".map") ? SRGBColorSpace : NoColorSpace;
  made.wrapS = made.wrapT = RepeatWrapping;
  made.magFilter = LinearFilter;
  made.minFilter = LinearMipmapLinearFilter;
  made.generateMipmaps = true;
  made.anisotropy = 8;
  made.needsUpdate = true;

  return made;
}

/** One map of a material's group: the warm-up worker's, or generated here on first use. */
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

/** Faces carry their UVs in texture repeats; these are a repeat's metres on each finish. */
export const REPEAT = {
  plaster: [3, 3],
  tiles: [2.4, 2.64],
  render: [2.4, 2.4],
  lawn: [3, 3],
  // The prototype's: eight courses of pavers in 1.6 m.
  paving: [1.6, 1.6],
  driveway: [4, 4],
  gravel: [1.2, 1.2],
  path: [2.4, 2.4],
  wood: [1.6, 1.6],
} as const;

/** Mineral plaster for walls. */
export function plaster(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: map("plaster", "map"),
    normalMap: map("plaster", "normal"),
    normalScale: new Vector2(0.6, 0.6),
    roughness: 0.92,
  });
}

/** Concrete roof tiles. */
export function tiles(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: map("tiles", "map"),
    normalMap: map("tiles", "normal"),
    roughnessMap: map("tiles", "rough"),
    normalScale: new Vector2(1.2, 1.2),
    roughness: 1,
  });
}

/** Grey render: flat roofs, obstacles, chimneys and poles. */
export function render(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: map("plinth", "map"),
    normalMap: map("plinth", "normal"),
    roughness: 0.85,
  });
}

export function bark(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: map("bark", "map"),
    normalMap: map("bark", "normal"),
    roughness: 0.95,
  });
}

/** Leaves take their colour per instance; the grass's blades give them grain. */
export function leaves(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    roughness: 0.8,
    normalMap: map("grass", "normal"),
    normalScale: new Vector2(1.5, 1.5),
  });
}

export function lawn(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: map("grass", "map"),
    normalMap: map("grass", "normal"),
    roughness: 0.95,
  });
}

/** A hedge's body under its leaves: dark, so gaps between the clusters read as depth. */
export function hedge(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x1f2e16,
    roughness: 0.9,
    normalMap: map("grass", "normal"),
    normalScale: new Vector2(1.5, 1.5),
  });
}

/** Ground finishes, each from its own generated maps. */
export const GROUND: Readonly<Record<GroundFinish, () => MeshStandardMaterial>> = {
  lawn,
  paving: () => paved("pavers", 0.8),
  driveway: () => paved("asphalt", 1),
  gravel: () => paved("gravel", 0.95),
  path: () => paved("flags", 0.85),
};

function paved(name: "pavers" | "asphalt" | "gravel" | "flags", roughness: number) {
  return new MeshStandardMaterial({
    map: map(name, "map"),
    normalMap: map(name, "normal"),
    roughness,
    // Over the lawn and over earlier surfaces, never flickering through them.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Fence finishes: painted boards, anthracite powder-coated bars, a rendered wall. */
export const FENCE: Readonly<Record<FenceFinish, () => MeshStandardMaterial>> = {
  wood: () =>
    new MeshStandardMaterial({
      map: map("wood", "map"),
      normalMap: map("wood", "normal"),
      roughness: 0.75,
    }),
  // The prototype's window frames.
  metal: () => new MeshStandardMaterial({ color: 0x2e3136, roughness: 0.45, metalness: 0.6 }),
  wall: plaster,
};

/** A wall-hung box: inverter or battery. */
export function equipment(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xeceef0, roughness: 0.4, metalness: 0.05 });
}

/**
 * A full-black module: black cells and backsheet under anti-reflective glass. Its emissive lights
 * the cells only.
 */
export function module(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map: map("module", "map"),
    roughnessMap: map("module", "rough"),
    roughness: 0.5,
    metalness: 0,
    // Anti-reflective glass. At the prototype's 0.35 and a clear coat the sky's reflection read
    // navy in the roof close-up; this reads black in both themes (SceneCanvas test).
    specularIntensity: 0.12,
    emissiveMap: map("module", "glow"),
    emissiveIntensity: 0,
    // Pulled toward the camera, so a module on its roof never flickers through it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
