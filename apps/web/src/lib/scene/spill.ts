// The light lit openings spill at night (ADR 20 Openings): one decal mesh out from their walls,
// on the lawn or on a lower roof under a window. No light of its own.
import { BufferGeometry, Float32BufferAttribute, Mesh } from "three";
import type { Face, Fitted, Point } from "../builder/pv.ts";
import { clipped, landingUnder, type Landing, type Plan } from "./landing.ts";
import { spilled } from "./decals.ts";

/** In metres and metres per metre of sill height. Light leaves through the opening and falls at
 * an angle, so its patch begins `start` out from the wall and `slope` further per metre of sill,
 * is `reach` deep and `past` wider than the opening on each side, deeper by `stretch` and wider
 * by `spread` per metre, and fainter until none lands from `ceiling` up. The sill is measured
 * from the surface the light lands on, found `probe` out from the wall: the lawn, or a lower roof
 * under the window. `lift` holds the patch clear of that surface. */
const SPILL = {
  start: 0.15,
  slope: 0.6,
  reach: 2.2,
  stretch: 1,
  past: 0.5,
  spread: 0.5,
  ceiling: 3,
  probe: 0.05,
  lift: 0.04,
} as const;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

/** Where an opening's light lands: on `landing`, from `near` to `far` out from the wall, `past`
 * beyond the opening on each side, at `strength` of an opening's with no sill. */
interface Cast {
  readonly landing: Landing;
  readonly near: number;
  readonly far: number;
  readonly past: number;
  readonly strength: number;
}

/** The light an opening throws on the surface under it, or none from too high above it. */
function cast({ corners: [low], out }: Fitted, roofs: readonly Face[]): Cast | undefined {
  const [east, north, up] = low;
  const probe: Point = [east + out[0] * SPILL.probe, north + out[1] * SPILL.probe, up];
  const landing = landingUnder(roofs, probe);
  const sill = Math.max(0, up - landing.height([east, north]));
  const strength = 1 - sill / SPILL.ceiling;

  if (strength <= 0) return undefined;

  const near = SPILL.start + sill * SPILL.slope;

  return {
    landing,
    near,
    far: near + SPILL.reach + sill * SPILL.stretch,
    past: SPILL.past + sill * SPILL.spread,
    strength,
  };
}

/** A patch's corners as a fan of triangles: positions, and UVs. */
interface Fan {
  readonly position: number[];
  readonly uv: number[];
}

/** One opening's patch on its landing; nothing where the light would land past a roof's edge.
 * Its map's first row is the edge nearest the wall. */
function patch({ corners: [low, right], out }: Fitted, thrown: Cast): Fan {
  const { landing, near, far, past } = thrown;
  const [east, north] = low;
  const width = Math.hypot(right[0] - east, right[1] - north) || 1;
  const [ae, an] = [(right[0] - east) / width, (right[1] - north) / width];
  const [oe, on] = out;

  const at = (across: number, off: number): Plan => [
    east + ae * across + oe * off,
    north + an * across + on * off,
  ];

  const corners = clipped(landing, [
    at(-past, near),
    at(-past, far),
    at(width + past, far),
    at(width + past, near),
  ]);

  const first = corners[0];
  const fan: Fan = { position: [], uv: [] };

  if (first === undefined) return fan;

  for (const [e, n] of corners.slice(1, -1).flatMap((b, i) => [first, b, corners[i + 2] ?? b])) {
    const [de, dn] = [e - east, n - north];

    fan.position.push(...toThree([e, n, landing.height([e, n]) + SPILL.lift]));
    fan.uv.push(
      (de * ae + dn * an + past) / (width + past * 2),
      (de * oe + dn * on - near) / (far - near),
    );
  }

  return fan;
}

/** The surfaces the `lit` openings light, out from their walls, as one mesh named "spill"; none
 * when no light lands. */
export function spill(lit: readonly Fitted[], roofs: readonly Face[]): Mesh | undefined {
  const drawn: Fan = { position: [], uv: [] };
  const colour: number[] = [];

  for (const opening of lit) {
    const thrown = cast(opening, roofs);
    const { position, uv } = thrown === undefined ? drawn : patch(opening, thrown);

    if (thrown !== undefined) {
      drawn.position.push(...position);
      drawn.uv.push(...uv);
      colour.push(...position.map(() => thrown.strength));
    }
  }

  if (colour.length === 0) return undefined;

  const patches = new BufferGeometry();

  patches.setAttribute("position", new Float32BufferAttribute(drawn.position, 3));
  patches.setAttribute("uv", new Float32BufferAttribute(drawn.uv, 2));
  patches.setAttribute("color", new Float32BufferAttribute(colour, 3));
  patches.computeVertexNormals();

  const mesh = new Mesh(patches, spilled());

  mesh.name = "spill";
  mesh.visible = false;
  // Over the lawn, which is transparent where it fades.
  mesh.renderOrder = 1;

  return mesh;
}
