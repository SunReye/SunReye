// A full-black module's maps, as pixels (ADR 20 Look), ported from the prototype's canvas drawing.
import type { Pixels, Rgb } from "./pixels.ts";

type ModuleMode = "albedo" | "glow" | "rough";

const MODULE = { w: 192, h: 320, columns: 6, rows: 10, gap: 1 } as const;

/** A cell's side: square, inside its gap. */
const SIDE = MODULE.w / MODULE.columns - MODULE.gap * 2;

/** Where a pixel falls on a module: its cell, and its place inside it; null on the backsheet. */
function cellAt(x: number, y: number): { i: number; j: number; cx: number; cy: number } | null {
  const [cw, ch] = [MODULE.w / MODULE.columns, MODULE.h / MODULE.rows];
  const [i, j] = [Math.floor(x / cw), Math.floor(y / ch)];
  const [cx, cy] = [x - i * cw - MODULE.gap, y - j * ch - MODULE.gap];
  const inside = cx >= 0 && cy >= 0 && cx < cw - MODULE.gap * 2 && cy < ch - MODULE.gap * 2;

  return inside ? { i, j, cx, cy } : null;
}

const grey = (v: number): Rgb => [v, v, v];

/** A cell's own colour: neutral near-black, a slight sheen per cell, darkening across it. */
function cellAlbedo(i: number, j: number, cx: number, cy: number): Rgb {
  const v = 11 + ((i * 7 + j * 3) % 5) * 0.6;
  const t = (cx + 0.5 + cy + 0.5) / (SIDE * 2);

  return [v + 1 - 3 * t, v + 2 - 4 * t, v + 3 - 4 * t];
}

/** Whether a point of a cell lies on one of its nine busbar wires. */
function onWire(cx: number): boolean {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].some((b) => Math.abs(cx + 0.5 - (SIDE * b) / 10) < 0.5);
}

/** A cell's point in each map: rough, glow mask or albedo. */
const cellPixel: Readonly<
  Record<ModuleMode, (i: number, j: number, cx: number, cy: number) => Rgb>
> = {
  rough: (_i, _j, cx) => grey(onWire(cx) ? 85 : 58),
  glow: (_i, _j, cx, cy) => {
    const d = Math.hypot(cx + 0.5 - SIDE / 2, cy + 0.5 - SIDE / 2) / (SIDE * 0.75);

    return grey(onWire(cx) ? 26 : 255 + (42 - 255) * Math.min(1, d));
  },
  albedo: (i, j, cx, cy) => {
    const [r, g, b] = cellAlbedo(i, j, cx, cy);

    // A wire is rgb(60, 62, 66) at 35 % over half the pixel.
    return onWire(cx) ? [r * 0.825 + 10.5, g * 0.825 + 10.85, b * 0.825 + 11.55] : [r, g, b];
  },
};

/** The backsheet's and the half-cut seam's grey in each map. */
const SHEET: Readonly<Record<ModuleMode, readonly [number, number]>> = {
  albedo: [6, 5],
  glow: [0, 17],
  rough: [138, 138],
};

/** One pixel of a module's map: its backsheet, cell, half-cut seam and busbar wires. */
function modulePixel(mode: ModuleMode, x: number, y: number): Rgb {
  const at = cellAt(x, y);
  const [sheet, seam] = SHEET[mode];

  if (at === null) return grey(sheet);

  // The half-cut seam, barely lighter than the cell.
  if (Math.abs(at.cy + 0.5 - SIDE / 2) < 0.5) return grey(seam);

  return cellPixel[mode](at.i, at.j, at.cx, at.cy);
}

function moduleMap(mode: ModuleMode): Pixels {
  const data = new Uint8ClampedArray(MODULE.w * MODULE.h * 4);

  for (let y = 0; y < MODULE.h; y++)
    for (let x = 0; x < MODULE.w; x++) {
      const i = (y * MODULE.w + x) * 4;

      [data[i], data[i + 1], data[i + 2]] = modulePixel(mode, x, y);
      data[i + 3] = 255;
    }

  return { w: MODULE.w, h: MODULE.h, data };
}

/**
 * A full-black module: 6 × 10 half-cut mono cells on a black backsheet, faint multi-busbar wires.
 * `module.glow` is the cells-only mask the string glow lights up.
 */
export function module() {
  return {
    "module.map": moduleMap("albedo"),
    "module.glow": moduleMap("glow"),
    "module.rough": moduleMap("rough"),
  };
}
