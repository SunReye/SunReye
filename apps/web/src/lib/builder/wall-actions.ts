// What the context toolbar adds at a wall spot (ADR 20): an opening or a marker where the finger
// was, picked at once in one undo step, the inspector left where it is; or why not, in words.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import { haptics } from "../haptics.ts";
import { m } from "../paraglide/messages.js";
import type { Equipment, OpeningKind, Unfit } from "./pv.ts";
import type { Session } from "./session.svelte.ts";
import { markerAt, openingAt } from "./wall-spot.ts";

export type WallAdd =
  | { readonly opening: OpeningKind }
  | { readonly marker: Equipment["kind"]; readonly device: number };

const REFUSED: Readonly<Record<Unfit, () => string>> = {
  overlap: m.opening_refused_overlap,
  room: m.opening_refused_room,
};

/** Adds `add` at the session's wall spot and picks it; the reason, where it does not fit. */
export function addOnWall(session: Session, add: WallAdd): string | undefined {
  const { draft, plan } = session;
  const { spot } = session.stance;

  if (spot === undefined) return undefined;

  const scene =
    "opening" in add
      ? openingAt(plan.pv, draft.scene, spot, add.opening)
      : markerAt(plan.pv, draft.scene, spot, { kind: add.marker, device: add.device });

  if ("unfit" in scene) {
    haptics.error();

    return "opening" in add ? REFUSED[scene.unfit]() : m.marker_refused_room();
  }

  session.change({ ...draft, scene });
  session.go(
    "opening" in add
      ? { kind: "opening", index: (scene.openings?.length ?? 1) - 1 }
      : { kind: "marker", index: (scene.equipment?.length ?? 1) - 1 },
  );

  return undefined;
}
