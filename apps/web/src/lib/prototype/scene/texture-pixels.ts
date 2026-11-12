// PROTOTYPE: the pixel maths of the procedural textures. Pure: no three.js and no DOM, so the same
// code runs in a worker (the scene's background load) and, as a fallback, on the main thread.

export interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Seeded PRNG so textures are stable across reloads. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** Tileable value noise: a lattice of `period` cells that wraps. */
function noiseField(size: number, period: number, seed: number): Float32Array {
  const r = rng(seed);
  const lat = Array.from({ length: period * period }, () => r());
  const out = new Float32Array(size * size);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = s(fx - x0), ty = s(fy - y0);
      const at = (i: number, j: number) => lat[((j % period) * period + (i % period)) % lat.length]!;
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  return out;
}

/** Fractal noise in 0..1, tileable. */
function fbm(size: number, base: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noiseField(size, base * 2 ** o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i]! += n[i]! * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

/** Tangent-space normal map from a height field (Sobel), wrapping at the edges. */
function normalFrom(height: Float32Array, w: number, h: number, strength: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len) * 255;
      data[i + 3] = 255;
    }
  return { w, h, data };
}

function fromField(field: Float32Array, size: number, colour: (v: number, i: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const [r, g, b] = colour(field[i]!, i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { w: size, h: size, data };
}

/** One generator per material; each returns its maps by cache key. */
export const GROUPS = {
  /** Mineral plaster: warm off-white with a fine float-finish grain. */
  plaster: () => ({
    "plaster.map": fromField(fbm(512, 8, 5, 11), 512, (v) => {
      const k = 0.94 + (v - 0.5) * 0.07;
      return [206 * k, 199 * k, 186 * k];
    }),
    "plaster.normal": normalFrom(fbm(512, 32, 4, 12), 512, 512, 2.2),
  }),
  /** Grey render for the plinth. */
  plinth: () => ({
    "plinth.map": fromField(fbm(256, 8, 5, 21), 256, (v) => {
      const k = 0.9 + (v - 0.5) * 0.15;
      return [128 * k, 126 * k, 122 * k];
    }),
    "plinth.normal": normalFrom(fbm(256, 32, 4, 22), 256, 256, 3),
  }),
  /** Concrete roof tiles, 8 x 8 per texture: double-wave profile, overlap shadow, per-tile tone. */
  tiles: () => {
    const S = 512, cols = 8, rows = 8, tw = S / cols, th = S / rows;
    const r = rng(31);
    const tone = Array.from({ length: cols * rows }, () => 0.86 + r() * 0.22);
    const grain = fbm(S, 16, 4, 32);
    const height = new Float32Array(S * S);
    const albedo = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / th);
        const col = Math.floor(x / tw);
        const u = (x % tw) / tw;
        const v = (y % th) / th; // 0 at the top (towards the ridge), 1 at the lower edge
        const wave = 0.5 + 0.5 * Math.cos(u * Math.PI * 4);
        const slope = v * 0.6; // each tile rises towards its lower edge, then drops to the next
        const lip = v > 0.94 ? (1 - v) / 0.06 : 1;
        const h = (wave * 0.35 + slope) * lip;
        const i = y * S + x;
        height[i] = h + grain[i]! * 0.05;
        const t = tone[row * cols + col]!;
        const shade = 0.55 + 0.45 * Math.min(1, v * 4); // shadow under the tile above
        albedo[i] = t * shade * (0.92 + grain[i]! * 0.16) * (0.85 + wave * 0.15);
        rough[i] = 0.72 + grain[i]! * 0.25;
      }
    return {
      "tiles.map": fromField(albedo, S, (v) => [50 * v, 50 * v, 52 * v]),
      "tiles.normal": normalFrom(height, S, S, 9),
      "tiles.rough": fromField(rough, S, (v) => [v * 255, v * 255, v * 255]),
    };
  },
  /** Lawn: mottled greens with blade streaks. */
  grass: () => {
    const S = 512;
    const n = fbm(S, 6, 6, 41);
    const blades = fbm(S, 64, 2, 42);
    return {
      "grass.map": fromField(n, S, (v, i) => {
        const b = blades[i]!;
        const k = 0.7 + v * 0.5 + (b - 0.5) * 0.35;
        const dry = Math.max(0, v - 0.62) * 1.6;
        return [(60 + dry * 40) * k, (80 + dry * 12) * k, (34 + dry * 6) * k];
      }),
      "grass.normal": normalFrom(blades, S, S, 4),
    };
  },
  /** Concrete pavers in running bond with sand joints. */
  pavers: () => {
    const S = 512, rows = 8, cols = 4;
    const r = rng(51);
    const tone = Array.from({ length: rows * (cols + 1) }, () => 0.85 + r() * 0.2);
    const grain = fbm(S, 16, 4, 52);
    const height = new Float32Array(S * S);
    const albedo = new Float32Array(S * S);
    const ph = S / rows, pw = S / cols;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / ph);
        const off = row % 2 ? pw / 2 : 0;
        const xx = (x + off) % S;
        const col = Math.floor(xx / pw);
        const jx = Math.min(xx % pw, pw - (xx % pw));
        const jy = Math.min(y % ph, ph - (y % ph));
        const joint = Math.min(jx, jy) < 3;
        const bevel = Math.min(1, Math.min(jx, jy) / 7);
        const i = y * S + x;
        height[i] = joint ? 0 : 0.6 + bevel * 0.4 + grain[i]! * 0.08;
        albedo[i] = joint ? 0.55 : tone[row * (cols + 1) + col]! * (0.9 + grain[i]! * 0.2);
      }
    return {
      "pavers.map": fromField(albedo, S, (v) => [132 * v, 128 * v, 121 * v]),
      "pavers.normal": normalFrom(height, S, S, 4),
    };
  },
  /** Bark: vertical furrows. */
  bark: () => {
    const W = 256, H = 256;
    const n = fbm(W, 4, 5, 61);
    const field = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = Math.abs(Math.sin((x / W) * Math.PI * 14 + n[y * W + x]! * 6));
        field[y * W + x] = f * 0.7 + n[((y * 3) % H) * W + x]! * 0.3;
      }
    return {
      "bark.map": fromField(field, W, (v) => [70 + v * 40, 58 + v * 32, 48 + v * 26]),
      "bark.normal": normalFrom(field, W, H, 6),
    };
  },
  /** Painted wood planks for the door. */
  wood: () => {
    const S = 256;
    const n = fbm(S, 4, 5, 71);
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const plank = (x % 32) < 1.5 ? 0 : 1;
        field[y * S + x] = plank * (0.8 + 0.2 * Math.sin(y * 0.15 + n[y * S + x]! * 10));
      }
    return {
      "wood.map": fromField(field, S, (v) => [44 + v * 22, 52 + v * 24, 60 + v * 26]),
      "wood.normal": normalFrom(field, S, S, 5),
    };
  },
} satisfies Record<string, () => Record<string, Pixels>>;

export type GroupName = keyof typeof GROUPS;
