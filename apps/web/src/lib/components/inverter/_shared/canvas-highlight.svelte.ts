/**
 * The hovered-band highlight for a **canvas** LayerChart.
 *
 * In the SVG charts the wash comes from the `.lc-highlight-area` CSS rule (a
 * translucent `currentColor`), but the canvas renderer cannot read that rule and
 * falls back to an opaque fill — an ugly solid bar over the hovered band. The fix
 * is to hand it a concrete colour, so this reads the resolved foreground off the
 * mounted container and the caller applies it at a low opacity:
 *
 * ```svelte
 * const highlight = canvasHighlight();
 * <div bind:this={highlight.el}>
 *   <BarChart highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }} …>
 * ```
 *
 * Shared because every canvas chart needs the identical workaround, and a copy
 * per chart is how the two of them drifted into a clone.
 */
export function canvasHighlight() {
  let el = $state<HTMLElement | null>(null);
  return {
    get el() {
      return el;
    },
    set el(next: HTMLElement | null) {
      el = next;
    },
    /** Concrete fill for the highlight area; a neutral grey until mounted. */
    get fill() {
      return el ? getComputedStyle(el).color : "oklch(0.556 0 0)";
    },
  };
}
