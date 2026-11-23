// What the context toolbar adds at a wall spot (ADR 20): an opening or a marker where the finger
// was, picked at once in one undo step, the inspector left where it is; or why not, in words.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import { refusedInline } from "../feedback.ts";
import { m } from "../paraglide/messages.js";
import { UNFIT } from "./names.ts";
import type { Equipment, OpeningKind } from "./pv.ts";
import type { Session } from "./session.svelte.ts";
import { markerAt, openingAt } from "./wall-spot.ts";

export type WallAdd =
  | { readonly opening: OpeningKind }
  | { readonly marker: Equipment["kind"]; readonly device: number };

/** Adds `add` at the session's wall spot and picks it; the reason, where it does not fit. */
export function addOnWall(session: Session, add: WallAdd): string | undefined {
  const { draft, plan } = session;
  const { spot } = session.picking;

  if (spot === undefined) return undefined;

  const scene =
    "opening" in add
      ? openingAt(plan.pv, draft.scene, spot, add.opening)
      : markerAt(plan.pv, draft.scene, spot, { kind: add.marker, device: add.device });

  if ("unfit" in scene) {
    refusedInline();

    return "opening" in add ? UNFIT[scene.unfit]() : m.marker_refused_room();
  }

  session.change({ ...draft, scene });
  session.go(
    "opening" in add
      ? { kind: "opening", index: (scene.openings?.length ?? 1) - 1 }
      : { kind: "marker", index: (scene.equipment?.length ?? 1) - 1 },
  );

  return undefined;
}
