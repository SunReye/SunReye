// Ground and fence maps as pixels (ADR 20 Surroundings): pavers and planks ported from the
// prototype, flags, gravel and asphalt made to match. Pure: no three.js and no DOM.
import { fbm, fromField, normalFrom, rng, type Rgb } from "./noise.ts";

/** Stones laid in courses: `rows` × `columns` per texture, every other course shifted. */
interface Bond {
  readonly size: number;
  readonly rows: number;
  readonly columns: number;
  /** Of a stone's width. */
  readonly shift: number;
}

/** Which stone a pixel lies on, by course and column, and its distance to the nearest joint. */
interface Laid {
  readonly stone: number;
  readonly joint: number;
}

function laid(bond: Bond, x: number, y: number): Laid {
  const [ph, pw] = [bond.size / bond.rows, bond.size / bond.columns];
  const row = Math.floor(y / ph);
  const across = (x + (row % 2) * pw * bond.shift) % bond.size;

  return {
    stone: row * (bond.columns + 1) + Math.floor(across / pw),
    joint: Math.min(across % pw, pw - (across % pw), y % ph, ph - (y % ph)),
  };
}

/** A laid surface's height and albedo, each stone its own tone; `stone` shapes one pixel. */
function paved(
  bond: Bond,
  seed: number,
  stone: (joint: number, tone: number, grain: number) => readonly [number, number],
): readonly [Float32Array, Float32Array] {
  const { size, rows, columns } = bond;
  const random = rng(seed);
  const tones = Array.from({ length: rows * (columns + 1) }, () => random());
  const grain = fbm(size, 16, 4, seed + 1);
  const [height, albedo] = [new Float32Array(size * size), new Float32Array(size * size)];

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const { stone: at, joint } = laid(bond, x, y);
      const i = y * size + x;

      [height[i], albedo[i]] = stone(joint, tones[at] ?? 0.5, grain[i] ?? 0);
    }

  return [height, albedo];
}

/** Concrete pavers in running bond with sand joints, ported from the prototype. */
export function pavers() {
  const size = 512;

  const [height, albedo] = paved(
    { size, rows: 8, columns: 4, shift: 0.5 },
    51,
    (joint, tone, grain) =>
      joint < 3
        ? [0, 0.55]
        : [
            0.6 + Math.min(1, joint / 7) * 0.4 + grain * 0.08,
            (0.85 + tone * 0.2) * (0.9 + grain * 0.2),
          ],
  );

  return {
    "pavers.map": fromField(albedo, size, (v) => [132 * v, 128 * v, 121 * v]),
    "pavers.normal": normalFrom(height, size, size, 4),
  };
}

/** Sandstone flags for a path: large slabs, a warmer tone each, wide joints. */
export function flags() {
  const size = 512;

  const [height, albedo] = paved(
    { size, rows: 3, columns: 3, shift: 1 / 3 },
    81,
    (joint, tone, grain) =>
      joint < 5 ? [0, 0.5] : [0.7 + grain * 0.3, (0.82 + tone * 0.24) * (0.88 + grain * 0.24)],
  );

  return {
    "flags.map": fromField(albedo, size, (v) => [176 * v, 160 * v, 132 * v]),
    "flags.normal": normalFrom(height, size, size, 3),
  };
}

const GRAVEL = { size: 512, cells: 64 } as const;

/** The cells around a pixel's, its own included. */
const NEIGHBOURS = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const));

/** A pebble's centre in its cell and its tone, each 0..1. */
type Pebble = Rgb;

/** The distance in cells to the nearest pebble's centre around pixel `x`, `y`, wrapping, and
 * that pebble's tone (Worley noise). */
function nearest(pebbles: readonly Pebble[], x: number, y: number): readonly [number, number] {
  const { size, cells } = GRAVEL;
  const step = size / cells;
  let [near, tone] = [Infinity, 0];

  for (const [dx, dy] of NEIGHBOURS) {
    const [cx, cy] = [Math.floor(x / step) + dx, Math.floor(y / step) + dy];
    const at = ((cy + cells) % cells) * cells + ((cx + cells) % cells);
    const [px, py, own] = pebbles[at] ?? [0, 0, 0];
    const d = Math.hypot((cx + px) * step - x, (cy + py) * step - y) / step;

    if (d < near) [near, tone] = [d, own];
  }

  return [near, tone];
}

/** Gravel: packed pebbles, each its own grey to buff, shaded round. */
export function gravel() {
  const { size, cells } = GRAVEL;
  const random = rng(91);

  const pebbles = Array.from({ length: cells * cells }, (): Pebble => [
    random(),
    random(),
    random(),
  ]);

  const [height, albedo] = [new Float32Array(size * size), new Float32Array(size * size)];

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [near, tone] = nearest(pebbles, x, y);
      const dome = Math.max(0, 1 - near * 1.4);

      height[y * size + x] = dome;
      albedo[y * size + x] = (0.55 + dome * 0.45) * (0.75 + tone * 0.35);
    }

  return {
    "gravel.map": fromField(albedo, size, (v) => [150 * v, 144 * v, 134 * v]),
    "gravel.normal": normalFrom(height, size, size, 5),
  };
}

/** Asphalt for a driveway: weathered grey with a fine aggregate, lighter than the prototype's
 * road so the sky does not turn it to water. */
export function asphalt() {
  const size = 256;
  const grain = fbm(size, 48, 3, 101);

  return {
    "asphalt.map": fromField(fbm(size, 6, 4, 102), size, (v, i) => {
      const k = 0.85 + (v - 0.5) * 0.2 + ((grain[i] ?? 0) - 0.5) * 0.3;

      return [108 * k, 103 * k, 96 * k];
    }),
    "asphalt.normal": normalFrom(grain, size, size, 1),
  };
}

/** Wood planks, the prototype's door boards stained a warm brown for a fence. */
export function wood() {
  const size = 256;
  const noise = fbm(size, 4, 5, 71);
  const field = new Float32Array(size * size);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const plank = x % 32 < 1.5 ? 0 : 1;

      field[y * size + x] =
        plank * (0.8 + 0.2 * Math.sin(y * 0.15 + (noise[y * size + x] ?? 0) * 10));
    }

  return {
    "wood.map": fromField(field, size, (v) => [62 + v * 52, 44 + v * 36, 30 + v * 22]),
    "wood.normal": normalFrom(field, size, size, 5),
  };
}
