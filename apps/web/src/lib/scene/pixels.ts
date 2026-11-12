// The pixel maths of the scene's generated textures (ADR 20 Look: no texture files ship), ported
// from the prototype. Pure: no three.js and no DOM, so the same code can run in a worker.

import { module } from "./module-pixels.ts";

export interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** A material's maps by `<material>.<kind>`. */
export type Maps = Readonly<Record<string, Pixels>>;

export type Rgb = readonly [number, number, number];

/** Seeded PRNG, so textures are the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;

  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;

    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable value noise: a lattice of `period` cells that wraps. */
function noiseField(size: number, period: number, seed: number): Float32Array {
  const random = rng(seed);
  const lattice = Array.from({ length: period * period }, () => random());
  const out = new Float32Array(size * size);

  const at = (i: number, j: number): number =>
    lattice[((j % period) * period + (i % period)) % lattice.length] ?? 0;

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [fx, fy] = [(x / size) * period, (y / size) * period];
      const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
      const [tx, ty] = [smooth(fx - x0), smooth(fy - y0)];
      const [a, b, c, d] = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];

      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }

  return out;
}

/** Fractal noise in 0..1, tileable. */
function fbm(size: number, base: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let [amplitude, norm] = [1, 0];

  for (let o = 0; o < octaves; o++) {
    const noise = noiseField(size, base * 2 ** o, seed + o * 101);

    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (noise[i] ?? 0) * amplitude;

    norm += amplitude;
    amplitude *= 0.5;
  }

  return out.map((v) => v / norm);
}

/** A tangent-space normal map from a height field (Sobel), wrapping at the edges. */
function normalFrom(height: ArrayLike<number>, w: number, h: number, strength: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number): number => height[((y + h) % h) * w + ((x + w) % w)] ?? 0;

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;

      data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
      data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / length) * 255;
      data[i + 3] = 255;
    }

  return { w, h, data };
}

function fromField(
  field: ArrayLike<number>,
  size: number,
  colour: (v: number, i: number) => Rgb,
): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < field.length; i++) {
    [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] = colour(field[i] ?? 0, i);
    data[i * 4 + 3] = 255;
  }

  return { w: size, h: size, data };
}

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
export const GROUPS = { plaster, plinth, tiles, grass, bark, module } satisfies Readonly<
  Record<string, () => Maps>
>;

export type GroupName = keyof typeof GROUPS;
