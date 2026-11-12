// PROTOTYPE: procedural textures for the clay-to-real house scene. No files: the SPA ships in the
// core binary. Every texture is drawn once into a canvas and cached.
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function memo<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
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

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

function toTexture(c: HTMLCanvasElement, colour: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Tangent-space normal map from a height field (Sobel), wrapping at the edges. */
function normalFrom(height: Float32Array, w: number, h: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

function fromField(field: Float32Array, size: number, colour: (v: number, i: number) => [number, number, number]): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const [r, g, b] = colour(field[i]!, i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface PBR {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

/** Mineral plaster: warm off-white with a fine float-finish grain. */
export function plaster(): PBR {
  return {
    map: memo("plaster.map", () => {
      const n = fbm(512, 8, 5, 11);
      return toTexture(fromField(n, 512, (v) => {
        const k = 0.94 + (v - 0.5) * 0.07;
        return [206 * k, 199 * k, 186 * k];
      }), true);
    }),
    normalMap: memo("plaster.normal", () => normalFrom(fbm(512, 32, 4, 12), 512, 512, 2.2)),
  };
}

/** Grey render for the plinth. */
export function plinth(): PBR {
  return {
    map: memo("plinth.map", () => {
      const n = fbm(256, 8, 5, 21);
      return toTexture(fromField(n, 256, (v) => {
        const k = 0.9 + (v - 0.5) * 0.15;
        return [128 * k, 126 * k, 122 * k];
      }), true);
    }),
    normalMap: memo("plinth.normal", () => normalFrom(fbm(256, 32, 4, 22), 256, 256, 3)),
  };
}

/** Concrete roof tiles, 8 x 8 per texture: double-wave profile, overlap shadow, per-tile tone. */
export function roofTiles(): PBR & { roughnessMap: THREE.Texture } {
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
    map: memo("tiles.map", () => toTexture(fromField(albedo, S, (v) => [50 * v, 50 * v, 52 * v]), true)),
    normalMap: memo("tiles.normal", () => normalFrom(height, S, S, 9)),
    roughnessMap: memo("tiles.rough", () => toTexture(fromField(rough, S, (v) => [v * 255, v * 255, v * 255]), false)),
  };
}

/** Lawn: mottled greens with blade streaks. */
export function grass(): PBR {
  const S = 512;
  const n = fbm(S, 6, 6, 41);
  const blades = fbm(S, 64, 2, 42);
  return {
    map: memo("grass.map", () =>
      toTexture(fromField(n, S, (v, i) => {
        const b = blades[i]!;
        const k = 0.7 + v * 0.5 + (b - 0.5) * 0.35;
        const dry = Math.max(0, v - 0.62) * 1.6;
        return [(60 + dry * 40) * k, (80 + dry * 12) * k, (34 + dry * 6) * k];
      }), true),
    ),
    normalMap: memo("grass.normal", () => normalFrom(blades, S, S, 4)),
  };
}

/** Concrete pavers in running bond with sand joints. */
export function pavers(): PBR {
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
    map: memo("pavers.map", () => toTexture(fromField(albedo, S, (v) => [132 * v, 128 * v, 121 * v]), true)),
    normalMap: memo("pavers.normal", () => normalFrom(height, S, S, 4)),
  };
}

/** Bark: vertical furrows. */
export function bark(): PBR {
  const W = 256, H = 256;
  const n = fbm(W, 4, 5, 61);
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const f = Math.abs(Math.sin((x / W) * Math.PI * 14 + n[y * W + x]! * 6));
      field[y * W + x] = f * 0.7 + n[((y * 3) % H) * W + x]! * 0.3;
    }
  return {
    map: memo("bark.map", () => toTexture(fromField(field, W, (v) => [70 + v * 40, 58 + v * 32, 48 + v * 26]), true)),
    normalMap: memo("bark.normal", () => normalFrom(field, W, H, 6)),
  };
}

/** Painted wood planks for the door. */
export function wood(): PBR {
  const S = 256;
  const n = fbm(S, 4, 5, 71);
  const field = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const plank = (x % 32) < 1.5 ? 0 : 1;
      field[y * S + x] = plank * (0.8 + 0.2 * Math.sin(y * 0.15 + n[y * S + x]! * 10));
    }
  return {
    map: memo("wood.map", () => toTexture(fromField(field, S, (v) => [44 + v * 22, 52 + v * 24, 60 + v * 26]), true)),
    normalMap: memo("wood.normal", () => normalFrom(field, S, S, 5)),
  };
}

/**
 * A full-black module: 6 x 10 half-cut mono cells on a black backsheet, faint multi-busbar wires.
 * `glow` is the cells-only mask the string tint lights up.
 */
export function pvModule(): { map: THREE.Texture; glow: THREE.Texture; roughnessMap: THREE.Texture } {
  const W = 192, H = 320, cw = W / 6, ch = H / 10, gap = 1, cut = 0.6;
  const draw = (mode: "albedo" | "glow" | "rough") => {
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = mode === "albedo" ? "#060607" : mode === "glow" ? "#000" : "#8a8a8a";
    ctx.fillRect(0, 0, W, H);
    for (let j = 0; j < 10; j++)
      for (let i = 0; i < 6; i++) {
        const x = i * cw + gap, y = j * ch + gap, w = cw - gap * 2, h = ch - gap * 2;
        if (mode === "albedo") {
          // Neutral near-black with a slight per-cell sheen difference.
          const v = 11 + ((i * 7 + j * 3) % 5) * 0.6;
          const g = ctx.createLinearGradient(x, y, x + w, y + h);
          g.addColorStop(0, `rgb(${v + 1},${v + 2},${v + 3})`);
          g.addColorStop(1, `rgb(${v - 2},${v - 2},${v - 1})`);
          ctx.fillStyle = g;
        } else if (mode === "glow") {
          const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.75);
          g.addColorStop(0, "#fff");
          g.addColorStop(1, "#2a2a2a");
          ctx.fillStyle = g;
        } else ctx.fillStyle = "#3a3a3a";
        ctx.fillRect(x, y, w, h);
        // Half-cut seam and thin wires, barely lighter than the cell.
        ctx.fillStyle = mode === "albedo" ? "#050506" : mode === "glow" ? "#111" : "#8a8a8a";
        ctx.fillRect(x, y + h / 2 - cut / 2, w, cut);
        ctx.fillStyle = mode === "albedo" ? "rgba(60,62,66,0.35)" : mode === "glow" ? "#1a1a1a" : "#555";
        for (let b = 1; b <= 9; b++) ctx.fillRect(x + (w * b) / 10 - 0.25, y, 0.5, h);
      }
    return toTexture(c, mode === "albedo", false);
  };
  return {
    map: memo("pv.map", () => draw("albedo")),
    glow: memo("pv.glow", () => draw("glow")),
    roughnessMap: memo("pv.rough", () => draw("rough")),
  };
}

/** A small product label: name, model line and a status bar. */
export function label(key: string, title: string, sub: string, accent: string): THREE.Texture {
  return memo(`label.${key}`, () => {
    const [c, ctx] = canvas(256, 384);
    ctx.fillStyle = "#eef0f2";
    ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = "#2b2f36";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#fff";
    ctx.font = "600 30px Inter, sans-serif";
    ctx.fillText(title, 20, 43);
    ctx.fillStyle = "#59606b";
    ctx.font = "500 20px Inter, sans-serif";
    ctx.fillText(sub, 20, 104);
    ctx.fillStyle = accent;
    ctx.fillRect(20, 330, 60, 8);
    return toTexture(c, true, false);
  });
}

/** Radial alpha: opaque centre fading to nothing at the rim. */
export function radialFade(inner = 0.35): THREE.Texture {
  return memo(`fade.${inner}`, () => {
    const [c, ctx] = canvas(256);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "#fff");
    g.addColorStop(inner, "#fff");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return toTexture(c, false, false);
  });
}

/** Studio backdrop: a soft vignette in the page colour, lighter in the middle. */
export function vignette(page: THREE.Color, dark: boolean): THREE.Texture {
  const key = `vignette.${page.getHexString()}.${dark}`;
  return memo(key, () => {
    const [c, ctx] = canvas(512);
    const mid = page.clone().lerp(new THREE.Color(dark ? "#3a3f4a" : "#ffffff"), dark ? 0.35 : 0.6);
    const edge = page.clone().lerp(new THREE.Color("#000"), dark ? 0.25 : 0.06);
    const g = ctx.createRadialGradient(256, 210, 0, 256, 256, 380);
    g.addColorStop(0, `#${mid.getHexString(THREE.SRGBColorSpace)}`);
    g.addColorStop(0.55, `#${page.getHexString(THREE.SRGBColorSpace)}`);
    g.addColorStop(1, `#${edge.getHexString(THREE.SRGBColorSpace)}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const t = toTexture(c, true, false);
    return t;
  });
}
