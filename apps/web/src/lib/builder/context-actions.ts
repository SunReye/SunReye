// What the context toolbar's actions make of a session (ADR 20): each is also in the inspector,
// through the same functions of the draft.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import { haptics } from "../haptics.ts";
import { fillGrid } from "./modules.ts";
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

/** Where the selected face's free roof still takes a module; none off a face with a grid. */
export function freeAt(session: Session): (readonly [number, number])[] {
  const { draft, plan } = session;
  const grid = gridAt(session);

  return grid < 0 ? [] : plan.pv.fillFace({ scene: draft.scene, sizes: plan.sizes, grid });
}

/** Fills the selected face's free roof with modules, as "Fläche füllen" does. */
export function fillAt(session: Session): void {
  const free = freeAt(session);
  const { draft } = session;

  if (free.length > 0)
    session.change({ ...draft, scene: fillGrid(draft.scene, gridAt(session), free) });
}
