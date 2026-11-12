// Tileable noise, normal maps and colour fields for the generated textures (ADR 20 Look). Pure:
// no three.js and no DOM.

export interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** A material's maps by `<material>.<kind>`. */
export type Maps = Readonly<Record<string, Pixels>>;

export type Rgb = readonly [number, number, number];

/** Seeded PRNG, so textures are the same on every load. */
export function rng(seed: number): () => number {
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
export function fbm(size: number, base: number, octaves: number, seed: number): Float32Array {
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
export function normalFrom(
  height: ArrayLike<number>,
  w: number,
  h: number,
  strength: number,
): Pixels {
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

export function fromField(
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
