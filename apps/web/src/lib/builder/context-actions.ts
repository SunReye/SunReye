// What the context toolbar's actions make of a session (ADR 20): each is also in the inspector,
// through the same functions of the draft.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import { haptics } from "../haptics.ts";
import { addGrid, fillGrid } from "./modules.ts";
import { removal } from "./removal.ts";
import type { Session } from "./session.svelte.ts";
import { duplicate, refit } from "./wall-openings.ts";
import type { Light } from "./walls.ts";

/** The grid on the roof face the session stands at, by its position in the scene; −1 for none. */
export function gridAt({ level, draft }: Pick<Session, "level" | "draft">): number {
  return level.kind === "face"
    ? (draft.scene.grids ?? []).findIndex((g) => g.block === level.block && g.face === level.face)
    : -1;
}

/** Takes the selected object out of the draft and shows its group; whether there was one to take. */
export function removeAt(session: Session): boolean {
  const gone = removal(session.draft, session.level);

  if (gone === null) return false;

  session.change(gone.draft);
  session.go(gone.level);

  return true;
}

/** Adds an opening like the selected one beside it and picks it; false where its wall has no room. */
export function duplicateAt(session: Session): boolean {
  const { level, draft, plan } = session;
  const copied = level.kind === "opening" ? duplicate(plan.pv, draft.scene, level.index) : null;

  if (copied === null) {
    haptics.error();

    return false;
  }

  session.change({ ...draft, scene: copied });
  session.go({ kind: "opening", index: (copied.openings?.length ?? 1) - 1 });

  return true;
}

/** Sets the selected opening's night light. */
export function lightAt(session: Session, light: Light): void {
  const { level, draft, plan } = session;

  if (level.kind !== "opening") return;

  const lit = refit(plan.pv, draft.scene, level.index, { light });

  if (!("unfit" in lit)) session.change({ ...draft, scene: lit });
}

/** The selected face's grid, or one of the first module type on a face that has none, and where
 * its free roof still takes a module; null off a face, or without a module type to lay. */
function filling(session: Session) {
  const { level, draft, plan, moduleTypes } = session;
  const at = gridAt(session);
  const type = moduleTypes[0]?.id;

  if (level.kind !== "face" || (at < 0 && type === undefined)) return null;

  const scene =
    at < 0 && type !== undefined
      ? addGrid(draft.scene, level.block, level.face, type)
      : draft.scene;

  const grid = at < 0 ? (scene.grids?.length ?? 1) - 1 : at;

  return { scene, grid, free: plan.pv.fillFace({ scene, sizes: plan.sizes, grid }) };
}

/** Whether the selected face's free roof still takes a module. */
export function fillable(session: Session): boolean {
  return (filling(session)?.free.length ?? 0) > 0;
}

/** Fills the selected face's free roof with modules, as "Fläche füllen" does; a face without a
 * grid gets one of the first module type with them, in the same step. */
export function fillAt(session: Session): void {
  const filled = filling(session);

  if (filled === null || filled.free.length === 0) return;

  session.change({ ...session.draft, scene: fillGrid(filled.scene, filled.grid, filled.free) });
}
