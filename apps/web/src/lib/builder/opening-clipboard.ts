// Copy and paste for wall openings (ADR 20): Ctrl or Cmd with C remembers the picked opening, with
// V adds a copy of it as "Duplizieren" does. A text field keeps its own keys.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the session is edited through its own methods. */
import { haptics } from "../haptics.ts";
import type { Opening } from "./pv.ts";
import type { Session } from "./session.svelte.ts";
import { pasted } from "./wall-openings.ts";

/** Whether the key was typed into a field, which copies and pastes its own text. */
function typed({ target }: KeyboardEvent): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/** The letter pressed with Ctrl or Cmd alone, outside a field; null for any other key. */
function chord(event: KeyboardEvent): string | null {
  const held = (event.ctrlKey || event.metaKey) && !event.altKey;

  return held && !typed(event) ? event.key : null;
}

export class OpeningClipboard {
  #copied: Opening | undefined;

  /** Adds a copy beside the remembered opening and picks it; the next lands beside that one. */
  #paste(session: Session, copied: Opening): void {
    const { draft, plan } = session;
    const scene = pasted(plan.pv, draft.scene, copied);

    if (scene === null) {
      haptics.error();

      return;
    }

    this.#copied = scene.openings?.at(-1);
    session.change({ ...draft, scene });
    session.go({ kind: "opening", index: (scene.openings?.length ?? 1) - 1 });
  }

  /** Takes a key pressed anywhere in the builder: the copy and the paste, and no other. */
  key(event: KeyboardEvent, session: Session): void {
    const letter = chord(event);
    const { level, draft } = session;

    if (letter === "c" && level.kind === "opening") {
      this.#copied = draft.scene.openings?.[level.index];
    }

    if (letter === "v" && this.#copied !== undefined) {
      event.preventDefault();
      this.#paste(session, this.#copied);
    }
  }
}
