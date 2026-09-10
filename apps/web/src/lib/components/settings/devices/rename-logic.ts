/**
 * The name-only edit, as rules rather than as a form.
 *
 * A coded or a virtual row has no addressing the operator may change (#219
 * narrowed the server's refusal to exactly that), so what is left is the label
 * — and the three ways a label is not submittable are worth a test each: it is
 * empty, it breaks the slug rules, or it is what the row is already called.
 */

import { nameProblem } from "./add-device-logic";

export type RenameState = {
  /** What the operator typed, untrimmed — the field's own value. */
  typed: string;
  /** The row's current name, or null when no row is open. */
  current: string | null;
  submitting: boolean;
};

/** Why Save is refused, or null when it is not. */
export type RenameBlock = "no-row" | "submitting" | "empty" | "invalid" | "unchanged";

export function renameBlock(state: RenameState): RenameBlock | null {
  if (state.current === null) return "no-row";
  if (state.submitting) return "submitting";
  const trimmed = state.typed.trim();
  if (trimmed === "") return "empty";
  if (nameProblem(state.typed) !== null) return "invalid";
  // An unchanged name is not an error, it is a no-op: the PATCH would be a
  // round trip for nothing, and `nothing to change` would come back a 400.
  return trimmed === state.current ? "unchanged" : null;
}
