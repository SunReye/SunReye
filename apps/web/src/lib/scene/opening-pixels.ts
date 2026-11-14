// Windows' and doors' maps as pixels (ADR 20 Openings): a frame round dark panes, a panelled
// front door under a lit fanlight, a sectional garage door. Pure: no three.js and no DOM.
import { normalFrom, rng, type Maps, type Rgb } from "./noise.ts";

/** One pixel of an opening: its height for the normal map, albedo, roughness and night glow. */
interface Texel {
  readonly height: number;
  readonly albedo: Rgb;
  readonly rough: number;
  readonly glow: Rgb;
}

const DARK: Rgb = [0, 0, 0];

/** Maps `name.map`, `.normal`, `.rough` and `.glow` from one function of the pixel. */
function maps(
  name: string,
  [w, h]: readonly [number, number],
  at: (x: number, y: number) => Texel,
): Maps {
  const [albedo, rough, glow] = [0, 1, 2].map(() => new Uint8ClampedArray(w * h * 4));
  const height = new Float32Array(w * h);

  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const texel = at(x, y);
      const i = (y * w + x) * 4;

      height[y * w + x] = texel.height;
      albedo?.set([...texel.albedo, 255], i);
      rough?.set([texel.rough, texel.rough, texel.rough, 255], i);
      glow?.set([...texel.glow, 255], i);
    }

  return {
    [`${name}.map`]: { w, h, data: albedo ?? new Uint8ClampedArray() },
    [`${name}.normal`]: normalFrom(height, w, h, 3),
    [`${name}.rough`]: { w, h, data: rough ?? new Uint8ClampedArray() },
    [`${name}.glow`]: { w, h, data: glow ?? new Uint8ClampedArray() },
  };
}

/** White frame profiles, satin. */
const frame = (shade = 1): Texel => ({
  height: 1,
  albedo: [226 * shade, 226 * shade, 222 * shade],
  rough: 140,
  glow: DARK,
});

const WINDOW = { size: 128, frame: 9, mullion: 4 } as const;

/** A window: two casements in a white frame. By day the panes are dark and mirror the sky; lit,
 * a warm room shows behind curtains drawn part of the way. */
export function glazing() {
  const { size, frame: edge, mullion } = WINDOW;
  const random = rng(131);
  const folds = Array.from({ length: size }, () => 0.75 + random() * 0.25);

  return maps("window", [size, size], (x, y) => {
    const border = Math.min(x, y, size - 1 - x, size - 1 - y);

    if (border < edge || Math.abs(x - size / 2 + 0.5) < mullion) return frame();

    // The sash, a step down from the frame.
    if (border < edge + 4 || Math.abs(x - size / 2 + 0.5) < mullion + 4) {
      return { ...frame(0.93), height: 0.6 };
    }

    // Curtains at the sides, their folds falling; the room brighter low down.
    const side = Math.abs(x - size / 2) / (size / 2);
    const curtain = side > 0.62 ? 0.55 * (folds[x] ?? 1) : 1;
    const room = (0.7 + 0.3 * (y / size)) * curtain;

    return {
      height: 0,
      albedo: [16, 21, 28],
      rough: 18,
      glow: [255 * room, 196 * room, 120 * room],
    };
  });
}

const DOOR = { w: 64, h: 128, frame: 5, fanlight: 30 } as const;

/** The glazed fanlight over the door leaf, `border` pixels in from the door's sides. */
function fanlightAt(y: number, border: number) {
  const { frame: edge, fanlight } = DOOR;
  const pane = y > edge + 3 && y < fanlight - 4 && border > edge + 3;

  return pane
    ? { height: 0, albedo: [18, 22, 28] as const, rough: 20, glow: [255, 214, 150] as const }
    : frame(0.95);
}

/** The door leaf: two columns of three raised panels and a lever handle on the right. */
function leafAt(x: number, y: number) {
  const { w, h, frame: edge, fanlight } = DOOR;
  const [px, py] = [(x - edge) % ((w - edge * 2) / 2), (y - fanlight) % ((h - fanlight) / 3)];
  const raised = px > 6 && px < (w - edge * 2) / 2 - 6 && py > 6 && py < (h - fanlight) / 3 - 6;
  const handle = x > w - edge - 9 && x < w - edge - 4 && Math.abs(y - h * 0.6) < 5;

  if (handle) return { height: 1.4, albedo: [176, 178, 180] as const, rough: 70, glow: DARK };

  return {
    height: raised ? 0.9 : 0.6,
    albedo: raised ? ([52, 66, 78] as const) : ([44, 56, 67] as const),
    rough: 120,
    glow: DARK,
  };
}

/** A front door: raised panels in a dark door under a glazed fanlight, which is its light. */
export function door() {
  const { w, h, frame: edge, fanlight } = DOOR;

  return maps("door", [w, h], (x, y) => {
    const border = Math.min(x, y, w - 1 - x);

    if (border < edge) return frame();

    return y < fanlight ? fanlightAt(y, border) : leafAt(x, y);
  });
}

const GARAGE = { size: 128, frame: 5, sections: 4, ribs: 4 } as const;

/** A sectional garage door: four sections, each ribbed, in a light grey. */
export function sectional() {
  const { size, frame: edge, sections, ribs } = GARAGE;
  const section = size / sections;

  return maps("garage", [size, size], (x, y) => {
    if (Math.min(x, y, size - 1 - x) < edge) return frame(0.9);

    const joint = y % section < 2;
    const rib = (y % (section / ribs)) / (section / ribs);

    return {
      height: joint ? 0 : 0.6 + 0.25 * Math.sin(rib * Math.PI),
      albedo: joint ? [120, 122, 124] : [196, 198, 199],
      rough: 115,
      glow: DARK,
    };
  });
}

/** Light falling from a lit window onto the ground below: brightest at the wall, fading out. */
export function spill() {
  const size = 64;

  return maps("spill", [size, size], (x, y) => {
    // The wall is at the top edge.
    const across = 1 - Math.min(1, Math.abs(x - size / 2 + 0.5) / (size / 2));
    const away = 1 - y / size;
    const light = across ** 1.5 * away ** 2;

    return { height: 0, albedo: [255 * light, 196 * light, 120 * light], rough: 255, glow: DARK };
  });
}
