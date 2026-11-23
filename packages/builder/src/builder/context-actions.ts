// What the context toolbar's actions make of a session (ADR 20): each is also in the inspector,
// through the same functions of the draft.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import type { Light, Scene } from "@sunreye/builder/builder/pv.ts";
import { refusedInline } from "../feedback.ts";
import { bodyOf } from "@sunreye/builder/builder/handles/body.ts";
import { turnable } from "@sunreye/builder/builder/handles/offered.ts";
import { gridOn, handled } from "@sunreye/builder/builder/levels.ts";
import { addGrid, fillGrid } from "@sunreye/builder/builder/modules.ts";
import { removal } from "./removal.ts";
import type { Session } from "./session.svelte.ts";
import { duplicate, refit } from "@sunreye/builder/builder/wall-openings.ts";

/** The grid on the roof face the session stands at, by its position in the scene; −1 for none. */
export function gridAt({ level, draft }: Pick<Session, "level" | "draft">): number {
  return level.kind === "face" ? gridOn(draft.scene, level) : -1;
}

/** The selected object's turn in degrees, where it has a ring to turn it by. */
export function turnAt({
  level,
  draft,
  laid,
}: Pick<Session, "level" | "draft" | "laid">): number | undefined {
  const body =
    handled(level) && turnable(draft.scene, level, laid) ? bodyOf(draft.scene, level) : undefined;

  return body?.kind === "rect" ? body.rotation : undefined;
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
    refusedInline();

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

/** The scene with a grid on the selected face, and the grid: its own, or one of the first module
 * type; null off a face, or without a module type to lay. */
function gridded(session: Session): { scene: Scene; grid: number } | null {
  const { level, draft, moduleTypes } = session;
  const grid = gridAt(session);
  const [type] = moduleTypes;

  if (grid >= 0) return { scene: draft.scene, grid };

  if (level.kind !== "face" || type === undefined) return null;

  return {
    scene: addGrid(draft.scene, level.block, level.face, type.id),
    grid: draft.scene.grids?.length ?? 0,
  };
}

/** The selected face's grid and where its free roof still takes a module. */
function filling(session: Session) {
  const on = gridded(session);
  const { pv, sizes } = session.plan;

  return on && { ...on, free: pv.fillFace({ scene: on.scene, sizes, grid: on.grid }) };
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
