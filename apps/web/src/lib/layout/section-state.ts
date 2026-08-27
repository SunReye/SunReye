// fallow-ignore-file unused-type -- phase 2.1 of the layout system: the vocabulary is broader than the first wave of callers spends; later phases claim the rest
/**
 * The two decisions `section.svelte` makes, lifted out of the component so the
 * suite can call them (runes do not run under `bun test` — see
 * `apps/web/TESTING.md`).
 */

export type SectionOpenInput = {
  /** Whether the section renders a collapse trigger at all. */
  collapsible?: boolean;
  /** The bound open state; undefined before the caller (or viewer) sets one. */
  open?: boolean;
};

/**
 * Whether the section's content renders.
 *
 * A section without a trigger is always open: there would be no way back. And
 * an unset `open` means "not yet decided", not "closed" — a section whose
 * preference is still in flight must show its content, never blank out and
 * pop in.
 */
export function sectionOpen({ collapsible, open }: SectionOpenInput): boolean {
  if (!collapsible) return true;
  return open ?? true;
}

/**
 * Whether the section writes the toggle result back into its own `open` prop.
 *
 * Two modes, and they must not be mixed. Uncontrolled (the default) is a
 * `bind:open` or nothing at all: no one else will write the state, so the
 * section does. Controlled is a caller that recomputes `open` itself — the
 * statistics sections derive it from customize mode, a viewer override and a
 * stored preference — and a `$derived` cannot be `bind:`-ed. Writing it from in
 * here would hold only until the caller's next recompute, then snap back; the
 * caller reacts to `onOpenChange` instead.
 */
export function writesOwnOpen(controlled?: boolean): boolean {
  return !controlled;
}

/**
 * Collapse transition timing. Five of the six section variants this primitive
 * replaces animated unconditionally; a viewer who asked for reduced motion
 * gets the state change without the movement.
 */
export function slideParams(reduceMotion: boolean): { duration: number } {
  return { duration: reduceMotion ? 0 : 200 };
}
