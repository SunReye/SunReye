/**
 * The range switcher's selection rule, out here because a `.svelte` template is
 * the one place this repo cannot unit-test.
 */

/**
 * Folds a ToggleGroup report into the next value of the switcher.
 *
 * A single-select toggle group deselects on a second press of the active item
 * and reports `""` (bits-ui) — and a range switcher with no range selected has
 * no meaning: the chart beside it would have nothing to draw. Anything that is
 * not a non-empty string leaves `current` standing.
 */
export function commitRangeSelection<T extends string>(next: string | undefined, current: T): T {
  return typeof next === "string" && next.length > 0 ? (next as T) : current;
}
