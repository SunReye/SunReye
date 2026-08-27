/**
 * The hovered-band highlight for a **canvas** LayerChart.
 *
 * In the SVG charts the wash comes from the `.lc-highlight-area` CSS rule (a
 * translucent `currentColor`), but the canvas renderer cannot read that rule and
 * falls back to an opaque fill — an ugly solid bar over the hovered band. The fix
 * is to hand it a concrete colour, so this reads the resolved foreground off the
 * mounted container and spends it at an opacity you can still read a bar
 * through:
 *
 * ```svelte
 * const highlight = canvasHighlight();
 * <div bind:this={highlight.el}>
 *   <BarChart highlight={highlight.props} …>
 * ```
 *
 * Shared because every canvas chart needs the identical workaround, and a copy
 * per chart is how the two of them drifted into a clone. `props` and not just
 * `fill` for the same reason: handing back only the colour left all four charts
 * writing `{ area: { fill: …, fillOpacity: 0.1 } }` for themselves, which is one
 * decision in four places — and once the house-style pass made the markup around
 * that line identical too, it became the longest clone group in the app.
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
    /**
     * Everything a chart hands LayerChart's `highlight` prop, in one object.
     *
     * The opacity is the decision, not a caller's taste: a hover has one meaning
     * across the app, and a chart that picks 0.2 reads as a different state.
     * Low enough to read the bar underneath, high enough to find on a phone.
     */
    get props() {
      return { area: { fill: this.fill, fillOpacity: 0.1 } };
    },
  };
}
