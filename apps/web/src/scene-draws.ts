// The WebGL contexts a test drew on. Software WebGL is one renderer for every page: a file that
// draws belongs in the serial scene project (scene-tests.ts), which page.setup.ts holds the rest
// to; and a draw runs in the GPU process after its call returns, so page.setup.ts waits for the
// contexts a test drew on before the next test starts.

const DRAWS = [
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
] as const;

/** A WebGL context, as its draw calls see it and as a wait for it reads it. */
export interface Context {
  readonly canvas: unknown;
  readonly FRAMEBUFFER: number;
  readonly FRAMEBUFFER_BINDING: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readonly isContextLost: () => boolean;
  readonly getParameter: (name: number) => WebGLFramebuffer | null;
  readonly bindFramebuffer: (target: number, framebuffer: WebGLFramebuffer | null) => void;
  readonly readPixels: (
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ) => void;
}

export type Draw = (this: Context, ...args: readonly number[]) => void;

/** A WebGL context's prototype, as far as its draw calls. */
export type Drawing = Partial<Record<(typeof DRAWS)[number], Draw>>;

/**
 * Watches every draw call on the contexts' prototypes from now; the returned function tells the
 * contexts drawn on since it was last asked.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the prototypes are patched.
export function watchDraws(contexts: readonly { prototype: Drawing }[]): () => Set<Context> {
  let drawn = new Set<Context>();

  const watched = (draw: Draw): Draw =>
    function (this: Context, ...args: readonly number[]): void {
      drawn.add(this);
      draw.call(this, ...args);
    };

  for (const { prototype } of contexts)
    for (const name of DRAWS) {
      const draw = prototype[name];

      if (draw !== undefined) prototype[name] = watched(draw);
    }

  return () => {
    const was = drawn;

    drawn = new Set();

    return was;
  };
}

/**
 * Returns once the GPU has run every call made on `gl`: `finish()` does not wait in Chromium, a
 * read of one pixel does. The framebuffer bound is put back, so three.js's record of it holds.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the context, read from.
export function drain(gl: Context): void {
  if (gl.isContextLost()) return;

  const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
}
