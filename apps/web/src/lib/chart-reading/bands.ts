// What a chart read in bands shares (`reader.svelte.ts`): a band index held to the chart, and a
// brush across bands.

/** `v` held between the first band, 0, and `last`. */
export const clamp = (v: number, last: number): number => Math.min(last, Math.max(0, v));

/**
 * A brush across the bands `index` gives each place: from the lower band to the higher. A span
 * of one band narrows nothing; without `onbrush`, nothing selects.
 */
export function brushBands<P>(
  index: (p: P) => number,
  onbrush?: (from: number, to: number) => void,
): ((a: P, b: P) => boolean) | undefined {
  if (onbrush === undefined) return undefined;

  return (a, b) => {
    const [from, to] = [Math.min(index(a), index(b)), Math.max(index(a), index(b))];

    if (to <= from) return false;

    onbrush(from, to);

    return true;
  };
}
