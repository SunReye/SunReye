// The GPU's own time for a frame (ADR 21 "Measuring"), where the browser measures it: Chromium
// on most GPUs, and neither Safari nor a software renderer.

/** `EXT_disjoint_timer_query_webgl2`'s names, which the DOM's types lack. */
const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;

/** Queries whose time the GPU still owes: none is begun past these. */
const OWED = 4;

/** The GPU's time for what is drawn between `begin` and `end`, where the browser measures it. */
export class GpuTimer {
  readonly #gl: WebGL2RenderingContext | null;
  readonly #owed: WebGLQuery[] = [];
  #open = false;
  /** Milliseconds the GPU took over the last frame it has told of; null where it tells none. */
  last: number | null = null;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own context.
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const measures =
      gl instanceof WebGL2RenderingContext &&
      gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null;

    this.#gl = measures ? gl : null;
  }

  begin(): void {
    const gl = this.#gl;

    if (gl === null || this.#owed.length >= OWED) return;

    const query = gl.createQuery();

    gl.beginQuery(TIME_ELAPSED, query);
    this.#owed.push(query);
    this.#open = true;
  }

  end(): void {
    if (this.#open) this.#gl?.endQuery(TIME_ELAPSED);

    this.#open = false;
    this.#settle();
  }

  dispose(): void {
    for (const query of this.#owed) this.#gl?.deleteQuery(query);

    this.#owed.length = 0;
  }

  /** Takes the oldest query's time once the GPU has it. */
  #settle(): void {
    const gl = this.#gl;
    const [oldest] = this.#owed;

    if (gl === null || oldest === undefined) return;

    if (gl.getQueryParameter(oldest, gl.QUERY_RESULT_AVAILABLE) !== true) return;

    // A disjoint GPU (a throttle, a context switch) measured nothing true.
    if (gl.getParameter(GPU_DISJOINT) !== true) {
      this.last = Number(gl.getQueryParameter(oldest, gl.QUERY_RESULT)) / 1e6;
    }

    gl.deleteQuery(oldest);
    this.#owed.shift();
  }
}
