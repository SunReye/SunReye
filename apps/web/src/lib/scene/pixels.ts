// The pixel maths of the scene's generated textures (ADR 20 Look: no texture files ship), ported
// from the prototype. Pure: no three.js and no DOM, so the same code can run in a worker.

import { asphalt, flags, gravel, pavers, wood } from "./ground-pixels.ts";
import { module } from "./module-pixels.ts";
import { fbm, fromField, normalFrom, rng, type Maps, type Rgb } from "./noise.ts";

export type { Maps, Pixels, Rgb } from "./noise.ts";

/** Mineral plaster: warm off-white with a fine float-finish grain. */
function plaster() {
  return {
    "plaster.map": fromField(fbm(512, 8, 5, 11), 512, (v) => {
      const k = 0.94 + (v - 0.5) * 0.07;

      return [206 * k, 199 * k, 186 * k];
    }),
    "plaster.normal": normalFrom(fbm(512, 32, 4, 12), 512, 512, 2.2),
  };
}

/** Grey render: flat roofs, chimneys and other obstacles. */
function plinth() {
  return {
    "plinth.map": fromField(fbm(256, 8, 5, 21), 256, (v) => {
      const k = 0.9 + (v - 0.5) * 0.15;

      return [128 * k, 126 * k, 122 * k];
    }),
    "plinth.normal": normalFrom(fbm(256, 32, 4, 22), 256, 256, 3),
  };
}

const TILES = { size: 512, columns: 8, rows: 8 } as const;

/** One point of a roof tile: its height, albedo and roughness. */
function tile(x: number, y: number, tone: number, grain: number): Rgb {
  const [tw, th] = [TILES.size / TILES.columns, TILES.size / TILES.rows];
  const u = (x % tw) / tw;
  // 0 at the top, toward the ridge; 1 at the lower edge.
  const v = (y % th) / th;
  const wave = 0.5 + 0.5 * Math.cos(u * Math.PI * 4);
  // Each tile rises toward its lower edge, then drops to the next.
  const lip = v > 0.94 ? (1 - v) / 0.06 : 1;
  const height = (wave * 0.35 + v * 0.6) * lip + grain * 0.05;
  // The shadow under the tile above.
  const shade = 0.55 + 0.45 * Math.min(1, v * 4);

  return [height, tone * shade * (0.92 + grain * 0.16) * (0.85 + wave * 0.15), 0.72 + grain * 0.25];
}

/** Concrete roof tiles, 8 × 8 per texture: double-wave profile, overlap shadow, per-tile tone. */
function tiles() {
  const { size, columns, rows } = TILES;
  const random = rng(31);
  const tone = Array.from({ length: columns * rows }, () => 0.86 + random() * 0.22);
  const grain = fbm(size, 16, 4, 32);

  const [height, albedo, rough] = [
    new Float32Array(size * size),
    new Float32Array(size * size),
    new Float32Array(size * size),
  ];

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;

      const own =
        tone[Math.floor(y / (size / rows)) * columns + Math.floor(x / (size / columns))] ?? 1;

      [height[i], albedo[i], rough[i]] = tile(x, y, own, grain[i] ?? 0);
    }

  return {
    "tiles.map": fromField(albedo, size, (v) => [50 * v, 50 * v, 52 * v]),
    "tiles.normal": normalFrom(height, size, size, 9),
    "tiles.rough": fromField(rough, size, (v) => [v * 255, v * 255, v * 255]),
  };
}

/** Lawn: mottled greens with blade streaks. */
function grass() {
  const size = 512;
  const blades = fbm(size, 64, 2, 42);

  return {
    "grass.map": fromField(fbm(size, 6, 6, 41), size, (v, i) => {
      const k = 0.7 + v * 0.5 + ((blades[i] ?? 0) - 0.5) * 0.35;
      const dry = Math.max(0, v - 0.62) * 1.6;

      return [(60 + dry * 40) * k, (80 + dry * 12) * k, (34 + dry * 6) * k];
    }),
    "grass.normal": normalFrom(blades, size, size, 4),
  };
}

/** Bark: vertical furrows. */
function bark() {
  const size = 256;
  const noise = fbm(size, 4, 5, 61);
  const field = new Float32Array(size * size);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const furrow = Math.abs(Math.sin((x / size) * Math.PI * 14 + (noise[y * size + x] ?? 0) * 6));

      field[y * size + x] = furrow * 0.7 + (noise[((y * 3) % size) * size + x] ?? 0) * 0.3;
    }

  return {
    "bark.map": fromField(field, size, (v) => [70 + v * 40, 58 + v * 32, 48 + v * 26]),
    "bark.normal": normalFrom(field, size, size, 6),
  };
}

/** One generator per material; each returns its maps by `<material>.<kind>`. */
export const GROUPS = {
  plaster,
  plinth,
  tiles,
  grass,
  bark,
  module,
  pavers,
  flags,
  gravel,
  asphalt,
  wood,
} satisfies Readonly<Record<string, () => Maps>>;

export type GroupName = keyof typeof GROUPS;
