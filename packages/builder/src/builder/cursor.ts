// The cursor over the canvas in an editor's navigation (ADR 20 "Navigation"): what a press there
// would do. Pure.
import type { RoofFaceId } from "@sunreye/scene";
import { bodyAt } from "./handles/body-at.ts";
import type { Editing } from "./handles/grabbing.ts";
import type { Hit } from "./scene.ts";

/** What the pointer is over, while no button is down. */
export interface Under {
  readonly hit: Hit | null;
  /** The roof face the hit is on; null off every roof. */
  readonly face: RoofFaceId | null;
  readonly editing: Editing | undefined;
  /** Space is held: every press pans. */
  readonly panning: boolean;
}

/** The CSS cursor: `grab` where a press pans, `move` on the picked object, which a drag moves,
 * `pointer` on anything a press picks, and the default on open ground, which a drag also pans. */
export function cursorOf({ hit, face, editing, panning }: Under): string {
  if (panning) return "grab";

  if (editing !== undefined && bodyAt(hit, editing) !== undefined) return "move";

  return hit === null || (hit.kind === "point" && face === null) ? "" : "pointer";
}
