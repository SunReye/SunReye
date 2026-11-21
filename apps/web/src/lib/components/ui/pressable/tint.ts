// Local (#836): the app's one row tint (ADR 21 "One behaviour, one component"). A pressable
// takes it by `feedback` and `selected`; a row that cannot be a pressable, a switch's label or a
// link, takes the same classes.

/** Under the pointer, the keyboard and a press. */
export const FEEDBACK =
  "hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] active:bg-foreground/[0.08]";

/** A row whose target is a link or a press inside it: the same steps, the keyboard's as it holds
 * the focus. */
export const FEEDBACK_WITHIN =
  "hover:bg-foreground/[0.04] has-focus-visible:bg-foreground/[0.06] active:bg-foreground/[0.08]";

/** A chosen row: a step above the pointer's tint, and a step more under it. */
export const SELECTED = "bg-foreground/[0.05] hover:bg-foreground/[0.07]";
