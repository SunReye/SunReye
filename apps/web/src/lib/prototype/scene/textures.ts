// PROTOTYPE: procedural textures for the clay-to-real house scene. No files: the SPA ships in the
// core binary. Every texture is made once and cached. The noise-based maps come as pixels from
// `texture-pixels`, generated in a worker before the scene is built (`warm`).
import * as THREE from "three";
import { GROUPS, type GroupName, type Pixels } from "./texture-pixels";
import { warmed } from "./warm";

const cache = new Map<string, THREE.Texture>();

function memo<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
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

const groups = new Map<GroupName, Record<string, THREE.CanvasTexture>>();

/** A material's maps as textures: from the worker's pixels, or generated here if it never ran. */
function group(name: GroupName): Record<string, THREE.CanvasTexture> {
  let g = groups.get(name);
  if (!g) {
    const pixels: Record<string, Pixels> = warmed[name] ?? GROUPS[name]();
    g = {};
    for (const [key, p] of Object.entries(pixels)) {
      const [c, ctx] = canvas(p.w, p.h);
      ctx.putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
      // Only the albedo is colour; normals and roughness are data.
      g[key] = toTexture(c, key.endsWith(".map"));
    }
    groups.set(name, g);
  }
  return g;
}

export interface PBR {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

const pbr = (name: GroupName): PBR => {
  const t = group(name);
  return { map: t[`${name}.map`]!, normalMap: t[`${name}.normal`]! };
};

export const plaster = (): PBR => pbr("plaster");
export const plinth = (): PBR => pbr("plinth");
export const grass = (): PBR => pbr("grass");
export const pavers = (): PBR => pbr("pavers");
export const bark = (): PBR => pbr("bark");
export const wood = (): PBR => pbr("wood");
export function roofTiles(): PBR & { roughnessMap: THREE.Texture } {
  const t = group("tiles");
  return { map: t["tiles.map"]!, normalMap: t["tiles.normal"]!, roughnessMap: t["tiles.rough"]! };
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
