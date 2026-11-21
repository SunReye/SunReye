// Whether a test drew with WebGL. Software WebGL is one renderer for every page: a file that draws
// belongs in the serial scene project (scene-tests.ts), which page.setup.ts holds the rest to.

const DRAWS = [
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
] as const;

/** A WebGL context, as its draw calls see it. */
export interface Context {
  readonly canvas: unknown;
}

export type Draw = (this: Context, ...args: readonly number[]) => void;

/** A WebGL context's prototype, as far as its draw calls. */
export type Drawing = Partial<Record<(typeof DRAWS)[number], Draw>>;

/**
 * Watches every draw call on the contexts' prototypes from now; the returned function says whether
 * one drew since it was last asked.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the prototypes are patched.
export function watchDraws(contexts: readonly { prototype: Drawing }[]): () => boolean {
  const seen = { drew: false };

  const watched = (draw: Draw): Draw =>
    function (this: Context, ...args: readonly number[]): void {
      seen.drew = true;
      draw.call(this, ...args);
    };

  for (const { prototype } of contexts)
    for (const name of DRAWS) {
      const draw = prototype[name];

      if (draw !== undefined) prototype[name] = watched(draw);
    }

  return () => {
    const was = seen.drew;

    seen.drew = false;

    return was;
  };
}
