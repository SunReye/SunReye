// The orbit camera's preset views and the view each browser keeps (ADR 20).
import type { Geometry, Point, RoofFace } from "./pv.ts";
import { toThree, type Triple } from "./scene.ts";

export const presets = ["north", "east", "south", "west", "top", "isometric"] as const;

export type Preset = (typeof presets)[number];

/** Where the camera stands and what it looks at, in three.js's frame. */
export interface View {
  readonly position: Triple;
  readonly target: Triple;
  /** It lands at once, without a flight: a hand turning the view moves it on each step. */
  readonly steady?: boolean | undefined;
}

/** The camera's vertical field of view, in degrees. */
export const FOV = 40;

/** Scene radii between the camera and the scene's centre. */
const DISTANCE = 2.5;
/** Metres around an empty scene. */

const EMPTY = 10;

/** Unit directions from the centre to the camera: north is −z, up is y. */
const directions: Readonly<Record<Preset, Triple>> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  // A hair off vertical: the orbit controls cannot look straight down their own up axis.
  top: [0, Math.cos(1e-3), Math.sin(1e-3)],
  // The south-east corner, 35.26° up: the cube diagonal.
  isometric: [Math.sqrt(1 / 3), Math.sqrt(1 / 3), Math.sqrt(1 / 3)],
};

/** Every point the scene reaches, in three.js's frame. */
function extremes(geometry: Geometry): Triple[] {
  const corners = geometry.faces.flatMap((face) => face.corners);

  const solids = geometry.solids.flatMap((solid): Point[] => {
    const { radius } = solid;
    const [e, n, u] = solid.kind === "sphere" ? solid.centre : solid.base;

    const [bottom, top] =
      solid.kind === "sphere" ? [u - radius, u + radius] : [u, u + solid.height];

    return [
      [e - radius, n - radius, bottom],
      [e + radius, n + radius, top],
    ];
  });

  return [...corners, ...solids].map((point) => toThree(point));
}

/** `direction` turned `heading` degrees clockwise seen from above, about the up axis. */
function turned([x, y, z]: Triple, heading: number): Triple {
  const by = (heading * Math.PI) / 180;

  return [x * Math.cos(by) - z * Math.sin(by), y, x * Math.sin(by) + z * Math.cos(by)];
}

/** The compass bearing `view` looks toward, degrees clockwise from north, 0 to 360: a compass
 * drawn over it points north at its negative. */
export function headingOf({ position, target }: View): number {
  const bearing = (Math.atan2(target[0] - position[0], position[2] - target[2]) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

/** The camera at `preset` around the scene's bounding box, far enough to see all of it on a canvas
 * `aspect` (width over height) wide: a narrower canvas than square stands it back. `heading` turns
 * it clockwise seen from above: the view from above then looks that way up the screen. */
export function presetView(preset: Preset, geometry: Geometry, aspect = 1, heading = 0): View {
  const found = extremes(geometry);
  // Nothing to bound: the origin, where the first block's corner will be.
  const points: Triple[] = found.length === 0 ? [[0, 0, 0]] : found;

  const low = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis] ?? 0)));
  const high = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis] ?? 0)));
  const centre = low.map((l, axis) => (l + (high[axis] ?? l)) / 2);

  const radius =
    found.length === 0 ? EMPTY : Math.hypot(...high.map((h, axis) => h - (centre[axis] ?? h)));

  const [x = 0, y = 0, z = 0] = centre;
  const [dx, dy, dz] = turned(directions[preset], heading);
  const far = (radius * DISTANCE) / Math.min(1, aspect);

  return {
    position: [x + dx * far, y + dy * far, z + dz * far],
    target: [x, y, z],
  };
}

/** How much of the canvas a face flown onto takes, across or up, whichever is tighter. */
const FILL = 0.85;

/** How far the camera leans down the slope, off the face's normal: the orbit controls cannot look
 * straight down, and the slope's upper edge stays up on screen. */
const LEAN = 1e-3;

/** The camera straight in front of a roof face, near enough that the face fills a canvas `aspect`
 * (width over height) wide: its cells are then large enough for a finger (ADR 20). */
export function faceView({ outline, origin, across, up }: RoofFace, aspect = 1): View {
  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [low, high] = [Math.min(...ys), Math.max(...ys)];
  const [cx, cy] = [(left + right) / 2, (low + high) / 2];

  const centre = origin.map((from, axis) => from + (across[axis] ?? 0) * cx + (up[axis] ?? 0) * cy);

  const [ae, an, au] = across;
  const [ue, un, uu] = up;
  // Across × up: out of the roof.
  const normal = [an * uu - au * un, au * ue - ae * uu, ae * un - an * ue];
  const half = Math.tan((FOV / 2) * (Math.PI / 180));
  const far = Math.max(high - low, (right - left) / aspect) / (2 * half * FILL);
  const toward = normal.map((n, axis) => n - LEAN * (up[axis] ?? 0));
  const length = Math.hypot(...toward);
  const [e = 0, n = 0, u = 0] = centre;
  const [de = 0, dn = 0, du = 0] = toward.map((part) => (part / length) * far);

  return { position: toThree([e + de, n + dn, u + du]), target: toThree([e, n, u]) };
}

function isTriple(value: unknown): value is Triple {
  return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

/** A view kept as JSON, or nothing when the text is not one. */
export function parseView(text: string | null): View | undefined {
  try {
    const value: unknown = JSON.parse(text ?? "");

    return value instanceof Object &&
      "position" in value &&
      isTriple(value.position) &&
      "target" in value &&
      isTriple(value.target)
      ? { position: value.position, target: value.target }
      : undefined;
  } catch {
    return undefined;
  }
}
