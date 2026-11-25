// A roof face selected across the views of one scene (ADR 25 "A roof face, in and out"): what a
// click on a roof answers, by its block and face, and the face a canvas marks by its key.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js's scene, added to in place. */
import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
import { untrack } from "svelte";
import type { Scene as Studio } from "three";
import { cssColour } from "../scene/backdrop.ts";
import { freeOverlay, markedFace } from "./overlay.ts";
import type { Panel } from "./panels.ts";
import type { RoofFace } from "./pv.ts";
import { roofFaceAt } from "./roof-face.ts";
import type { Hit } from "./strike.ts";

/** Metres a module's middle may stand off its roof: racks on a flat roof lift it most. */
const MODULE_OFF = 0.6;

/** The face `hit` struck: a roof's point, or a module's middle; null off every roof. */
export function faceOf(hit: Hit | null, roofs: readonly RoofFace[], panels: readonly Panel[]) {
  if (hit?.kind === "point") return roofFaceAt(roofs, hit.point);

  if (hit?.kind !== "grid") return null;

  const { corners = [] } =
    panels.find(({ grid, module }) => grid === hit.grid && module === hit.module) ?? {};

  const middle = [0, 1, 2].map(
    (axis) => corners.reduce((sum, corner) => sum + (corner[axis] ?? 0), 0) / corners.length,
  );

  const [east = 0, north = 0, up = 0] = middle;

  return corners.length === 0 ? null : roofFaceAt(roofs, [east, north, up], MODULE_OFF);
}

/** What a click hands the canvas's consumer: its hit, and the roof face it selects. */
export interface Selecting {
  readonly roofs: () => readonly RoofFace[] | undefined;
  readonly panels: () => readonly Panel[];
  readonly onpick: () => ((hit: Hit) => void) | undefined;
  readonly onselect: () => ((face: RoofFaceId | null) => void) | undefined;
}

/** A click's answer to both, or none when neither listens. */
export function selector({ roofs, panels, onpick, onselect }: Selecting) {
  return (): ((hit: Hit | null) => void) | undefined => {
    const pick = onpick();
    const select = onselect();

    if (pick === undefined && select === undefined) return undefined;

    return (hit) => {
      if (hit !== null) pick?.(hit);

      select?.(faceOf(hit, roofs() ?? [], panels()));
    };
  };
}

/** Keeps the outline of the face whose key `selected` gives, of `roofs`, in the studio, in
 * `colour`; returns its removal. */
export function marked(
  studio: Studio,
  roofs: () => readonly RoofFace[] | undefined,
  selected: () => string | undefined,
  render: () => void,
  colour = "var(--brand)",
): () => void {
  let shown: ReturnType<typeof markedFace> | undefined;

  const replace = (next?: ReturnType<typeof markedFace>): void => {
    if (shown !== undefined) {
      studio.remove(shown);
      freeOverlay(shown);
    }

    shown = next;

    if (next !== undefined) studio.add(next);
  };

  $effect(() => {
    const key = selected();
    const roof = key === undefined ? undefined : roofs()?.find((r) => roofFaceKey(r) === key);

    untrack(() => {
      replace(roof && markedFace(roof, cssColour(colour)));
      render();
    });
  });

  return () => {
    replace();
  };
}
