// What the context toolbar stands by (ADR 20): the points of the selection in the scene, which
// the canvas projects to a box. None, no toolbar. Pure.
import type { Selecting } from "@sunreye/builder/builder/gestures.ts";
import { offered } from "@sunreye/builder/builder/handles/offered.ts";
import { gridOn, handled, laying, type Level } from "@sunreye/builder/builder/levels.ts";
import type { Draft } from "@sunreye/builder/builder/modules.ts";
import type { Geometry, Modules, Point, RoofFace } from "@sunreye/builder/builder/pv.ts";

/** What the anchor reads of a session. */
export interface Anchored {
  readonly level: Level;
  readonly draft: Draft;
  readonly laid: Modules;
  readonly geometry: Pick<Geometry, "mounts">;
  readonly picking: {
    readonly turning: boolean;
    readonly spot?: { readonly at: Point } | undefined;
  };
  /** The wiring mode's selection, while it is on. */
  readonly roofwork: Pick<Selecting, "kind" | "chosen"> | { readonly kind: "modules" } | undefined;
}

/** A roof face's outline in the scene, out of its own frame. */
function cornersOf({ outline, origin, across, up }: RoofFace): Point[] {
  const [oe, on, ou] = origin;

  return outline.map(([x, y]): Point => [
    oe + across[0] * x + up[0] * y,
    on + across[1] * x + up[1] * y,
    ou + across[2] * x + up[2] * y,
  ]);
}

/** The outline of the grid on the face `level` names, or of its tapped module; of the roof face
 * itself while it holds no grid. */
function onFace({ draft, laid }: Anchored, level: Extract<Level, { kind: "face" | "module" }>) {
  const grid = gridOn(draft.scene, level);

  const shade = laid.grids[grid];

  if (shade === undefined || shade === null) {
    const roof = laying(laid.roofs, level);

    return roof === undefined ? [] : cornersOf(roof);
  }

  return level.kind === "module" ? (shade.modules[level.module]?.corners ?? []) : shade.outline;
}

/** The points of the selection: the selected modules, a face's grid or its module, an object's
 * handles and outline, or a marker's mount; none for a group, a string or the root. */
function anchorOf(session: Anchored): readonly Point[] {
  const { level, draft, laid, geometry, roofwork } = session;

  if (roofwork?.kind === "wiring") return roofwork.chosen.flatMap(({ corners }) => corners);

  if (level.kind === "face" || level.kind === "module") return onFace(session, level);

  // A wall spot carries the toolbar where the finger was.
  if (session.picking.spot !== undefined) return [session.picking.spot.at];

  if (level.kind === "marker")
    return [geometry.mounts?.[level.index]?.at].filter((at) => at !== undefined);

  if (!handled(level)) return [];

  // Three.js's x east, y up, z south, back to the crate's east, north, up.
  return offered(draft.scene, level, laid, session.picking.turning).flatMap(
    ({ at, outline = [] }) => [at, ...outline].map(([x, y, z]): Point => [x, 0 - z, y]),
  );
}

/** A box on the canvas, in its pixels. */
export interface Framed {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The selection's box on the canvas through `project`; null while all of it lies behind the
 * camera, or nothing is selected. */
export function boxOf(
  session: Anchored,
  project: (point: Point) => readonly [number, number] | null,
): Framed | null {
  const points = anchorOf(session).flatMap((point) => {
    const at = project(point);

    return at === null ? [] : [at];
  });

  if (points.length === 0) return null;

  const [xs, ys] = [points.map(([x]) => x), points.map(([, y]) => y)];

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** The levels that carry no toolbar: nothing there is one selected object. */
const BARE: ReadonlySet<Level["kind"]> = new Set(["root", "section", "string"]);

/** Which actions the selection carries; none for a group, a string or the root. */
export function carried(level: Level, selecting: boolean): "selection" | "face" | "object" | null {
  if (selecting) return "selection";

  if (BARE.has(level.kind)) return null;

  return level.kind === "face" ? "face" : "object";
}
