// A template's still picture: the crate's faces projected as the isometric preset sees them and
// painted far to near, so six thumbnails need no WebGL context (ADR 20).
import type { Face } from "./pv.ts";
import { cross, dot, normal, unit } from "./vector.ts";

/** One face on screen: SVG points, its finish, how much light it catches (0 to 1) and its paint. */
export interface Polygon {
  readonly points: string;
  readonly surface: Face["surface"];
  readonly light: number;
  readonly fill: string;
}

/** The 3D scene's tones (scene/materials.ts): clay walls under roofs of a cooler grey. */
const TONE = { wall: [230, 227, 221], roof: [201, 205, 210] } as const;

function paint(surface: Face["surface"], light: number): string {
  const finish = surface === "wall" ? TONE.wall : TONE.roof;

  const k = 0.55 + 0.45 * light;

  return `rgb(${finish.map((v) => Math.round(v * k)).join(" ")})`;
}

/** A face projected, before it is written out. */
interface Placed {
  readonly surface: Face["surface"];
  readonly light: number;
  readonly fill: string;
  readonly screen: readonly (readonly [number, number])[];
  readonly depth: number;
}

export interface Thumbnail {
  /** x, y, width, height. */
  readonly box: readonly [number, number, number, number];
  readonly polygons: readonly Polygon[];
}

/** Toward the camera from the south-east, 35° up: the isometric preset (east, north, up). */
const TOWARD = unit([1, -1, 1]);
const RIGHT = unit(cross([0, 0, 1], TOWARD));

const UP = cross(TOWARD, RIGHT);

/** Afternoon sun from the south-west, so the two walls in view differ. */
const SUN = unit([-0.4, -0.7, 0.6]);

/** Metres around the picture. */
const MARGIN = 1;

export function thumbnail(faces: readonly Face[]): Thumbnail {
  const placed = faces
    .map(({ surface, corners }): Placed => {
      const facing = normal(corners);
      const light = Math.abs(dot(facing, SUN));

      return {
        surface,
        light,
        fill: paint(surface, light),
        screen: corners.map((p) => [dot(p, RIGHT), -dot(p, UP)] as const),
        depth: corners.reduce((sum, p) => sum + dot(p, TOWARD), 0) / corners.length,
      };
    })
    .toSorted((a: Placed, b: Placed) => a.depth - b.depth);

  const xs = placed.flatMap(({ screen }) => screen.map(([x]: readonly [number, number]) => x));
  const ys = placed.flatMap(({ screen }) => screen.map(([, y]: readonly [number, number]) => y));
  const [left, top] = [Math.min(...xs) - MARGIN, Math.min(...ys) - MARGIN];

  return {
    box: [left, top, Math.max(...xs) + MARGIN - left, Math.max(...ys) + MARGIN - top],
    polygons: placed.map(({ surface, screen, light, fill }: Placed) => ({
      surface,
      light,
      fill,
      points: screen
        .map(([x, y]: readonly [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" "),
    })),
  };
}
