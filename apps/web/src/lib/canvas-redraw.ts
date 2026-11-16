// A canvas is drawn again when its size or the theme changes: its pixels follow neither.

/** Calls `redraw` now and on every change of the canvas' size or the theme, until the returned stop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM, used in place.
export function redrawn(canvas: HTMLCanvasElement, redraw: () => void): () => void {
  const sizes = new ResizeObserver(redraw);
  const theme = new MutationObserver(redraw);

  sizes.observe(canvas);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  redraw();

  return () => {
    sizes.disconnect();
    theme.disconnect();
  };
}
