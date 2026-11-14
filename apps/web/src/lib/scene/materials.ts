// The scene's physically based finishes, every map generated in code (ADR 20 Look). Textures are
// made once and shared; materials are made per build, so disposing a build keeps the textures.
import {
  AdditiveBlending,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from "three";
import type { FenceFinish, GroundFinish, OpeningKind } from "../builder/pv.ts";
import { GROUPS, type GroupName, type Pixels } from "./pixels.ts";
import { warmed } from "./warm.ts";
import { mean, weathered } from "./weather.ts";

const textures = new Map<string, DataTexture>();

/** The glow maps that hold a colour. */
const WARM: ReadonlySet<string> = new Set(["window.glow", "door.glow"]);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js uploads the pixels as they are.
function texture(key: string, pixels: Pixels): DataTexture {
  const made = new DataTexture(pixels.data, pixels.w, pixels.h);

  // The albedo is colour, and so is a lit room's glow; normals, roughness and a module's glow
  // mask are data.
  made.colorSpace = key.endsWith(".map") || WARM.has(key) ? SRGBColorSpace : NoColorSpace;
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

/** The material with its map's mean albedo turned to `colour`, `#rrggbb`; the grain stays. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
function painted(material: MeshStandardMaterial, colour: string | undefined): MeshStandardMaterial {
  if (colour === undefined || material.map === null || !(material.map instanceof DataTexture)) {
    return material;
  }

  const { r, g, b } = mean(material.map);
  const wanted = new Color(colour);

  material.color.setRGB(wanted.r / r, wanted.g / g, wanted.b / b);

  return material;
}

/** Mineral plaster for walls, in a block's wall colour. */
export function plaster(colour?: string): MeshStandardMaterial {
  return painted(plastered(), colour);
}

function plastered(): MeshStandardMaterial {
  return weathered(
    new MeshStandardMaterial({
      map: map("plaster", "map"),
      normalMap: map("plaster", "normal"),
      normalScale: new Vector2(0.6, 0.6),
      roughness: 0.92,
    }),
    // Rain streaks, and splashed dirt at the foot.
    { colour: 0.07, rough: 0.06, foot: 0.8 },
  );
}

/** Concrete roof tiles, in a block's roof colour. */
export function tiles(colour?: string): MeshStandardMaterial {
  return painted(tiled(), colour);
}

function tiled(): MeshStandardMaterial {
  return weathered(
    new MeshStandardMaterial({
      map: map("tiles", "map"),
      normalMap: map("tiles", "normal"),
      roughnessMap: map("tiles", "rough"),
      normalScale: new Vector2(1.6, 1.6),
      roughness: 1,
    }),
    // Patches of older, darker tiles.
    { colour: 0.16, rough: 0.12 },
  );
}

/** Grey render: flat roofs, obstacles, chimneys and poles; a flat roof in its block's colour. */
export function render(colour?: string): MeshStandardMaterial {
  return painted(
    weathered(
      new MeshStandardMaterial({
        map: map("plinth", "map"),
        normalMap: map("plinth", "normal"),
        roughness: 0.85,
      }),
      { colour: 0.12, rough: 0.1 },
    ),
    colour,
  );
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
  return weathered(
    new MeshStandardMaterial({
      map: map("grass", "map"),
      normalMap: map("grass", "normal"),
      roughness: 0.95,
    }),
    // Lusher and thinner stretches, and dry spots.
    { colour: 0.22, rough: 0.05, loose: true, patches: [1.22, 1.06, 0.72] },
  );
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
  paving: () => paved("pavers", 0.8, false),
  driveway: () => paved("asphalt", 1, true),
  gravel: () => paved("gravel", 0.95, true),
  path: () => paved("flags", 0.85, false),
};

/** Laid stones keep their bond; loose ground also takes a second scale of its map. */
function paved(name: "pavers" | "asphalt" | "gravel" | "flags", roughness: number, loose: boolean) {
  return weathered(
    new MeshStandardMaterial({
      map: map(name, "map"),
      normalMap: map(name, "normal"),
      roughness,
      // Over the lawn and over earlier surfaces, never flickering through them.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    { colour: 0.14, rough: 0.12, loose },
  );
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
  wall: () => plaster(),
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

const GLAZING: Readonly<Record<OpeningKind, "window" | "door" | "garage">> = {
  window: "window",
  frenchWindow: "window",
  frontDoor: "door",
  garageDoor: "garage",
};

/** A window or a door: its frame and leaf, panes that mirror the sky by day, and the glow of a
 * lit room or a door's light, dark until the lamps come on. */
export function glazed(kind: OpeningKind): MeshStandardMaterial {
  const name = GLAZING[kind];

  return new MeshStandardMaterial({
    map: map(name, "map"),
    normalMap: map(name, "normal"),
    roughnessMap: map(name, "rough"),
    roughness: 1,
    emissive: 0xffffff,
    emissiveMap: map(name, "glow"),
    emissiveIntensity: 0,
  });
}

/** Light on the ground from a lit opening: added to what lies there, each patch at the strength
 * in its vertex colours, and out by day. */
export function spilled(): MeshBasicMaterial {
  return new MeshBasicMaterial({
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
}
