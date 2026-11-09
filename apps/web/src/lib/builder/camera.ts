// The orbit camera's preset views and the view each browser keeps (ADR 20).
import type { Geometry, Point } from "./pv.ts";
import { toThree, type Triple } from "./scene.ts";

export const presets = ["north", "east", "south", "west", "top", "isometric"] as const;

export type Preset = (typeof presets)[number];

/** Where the camera stands and what it looks at, in three.js's frame. */
export interface View {
  readonly position: Triple;
  readonly target: Triple;
}

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

/** The camera at `preset` around the scene's bounding box, far enough to see all of it. */
export function presetView(preset: Preset, geometry: Geometry): View {
  const points = extremes(geometry);
  const low = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis] ?? 0)));
  const high = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis] ?? 0)));
  const centre = low.map((l, axis) => (l + (high[axis] ?? l)) / 2);

  const radius =
    points.length === 0 ? EMPTY : Math.hypot(...high.map((h, axis) => h - (centre[axis] ?? h)));

  const [x = 0, y = 0, z = 0] = centre;
  const [dx, dy, dz] = directions[preset];
  const far = radius * DISTANCE;

  return {
    position: [x + dx * far, y + dy * far, z + dz * far],
    target: [x, y, z],
  };
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
