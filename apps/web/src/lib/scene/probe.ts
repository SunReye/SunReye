// What a frame of the scene costs, counted (ADR 21 "Measuring"): its draws, its passes with the
// size of what each drew into, how often the sun's shadow map was drawn, the script's time and,
// where the browser measures it, the GPU's. Installed on a renderer only when asked for.
import type { WebGLRenderer } from "three";
import { GpuTimer } from "./gpu-timer.ts";

/** What is drawn into, whatever its textures: a target's size and multisampling. */
interface Target {
  readonly width: number;
  readonly height: number;
  readonly samples: number;
}

/** One binding of a target that drew something. */
export interface Pass {
  /** The sun's shadow map, the canvas, or a target of the passes. */
  readonly target: "shadow" | "canvas" | "target";
  readonly width: number;
  readonly height: number;
  /** Its multisampling; 0 for none. */
  readonly samples: number;
  readonly calls: number;
}

export interface Frame {
  readonly calls: number;
  readonly triangles: number;
  readonly programs: number;
  /** How often the sun's shadow map was drawn. */
  readonly shadows: number;
  readonly passes: readonly Pass[];
  /** Milliseconds of script the frame took. */
  readonly script: number;
}

export class Probe {
  readonly #renderer: WebGLRenderer;
  readonly #shadow: () => object | null;
  readonly #clock: () => number;
  readonly #gpu: GpuTimer;
  readonly #restore: () => void;
  /** When each frame of the last second was drawn. */
  #drawn: number[] = [];
  /** The passes of the frame being counted; none between frames, where Ultra's burst draws. */
  #passes: Pass[] | undefined;
  /** What is bound, and the renderer's draw calls when it was. */
  #bound: { readonly target: Target | null; readonly from: number } | undefined;
  #last: Frame | undefined;

  /** Counts what `renderer` draws; `shadow` is the sun's shadow map, once it has one. */
  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own, watched.
    renderer: WebGLRenderer,
    shadow: () => object | null,
    clock: () => number = () => performance.now(),
  ) {
    this.#renderer = renderer;
    this.#shadow = shadow;
    this.#clock = clock;
    this.#gpu = new GpuTimer(renderer.getContext());
    // Counted over a whole frame of passes, each a render of its own.
    renderer.info.autoReset = false;

    const bind = renderer.setRenderTarget.bind(renderer);

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own call.
    renderer.setRenderTarget = (...to) => {
      this.#bind(to[0] ?? null);
      bind(...to);
    };

    this.#restore = () => {
      renderer.setRenderTarget = bind;
      renderer.info.autoReset = true;
    };
  }

  /** The last frame drawn. */
  // fallow-ignore-next-line unused-class-member -- the readout reads it through `Studio["measure"]`.
  get last(): Frame | undefined {
    return this.#last;
  }

  /** Frames drawn in the last second. */
  // fallow-ignore-next-line unused-class-member -- the readout reads it through `Studio["measure"]`.
  get fps(): number {
    const since = this.#clock() - 1000;

    return this.#drawn.filter((at) => at > since).length;
  }

  /** Milliseconds the GPU took over a frame; null where the browser does not measure it. */
  // fallow-ignore-next-line unused-class-member -- the readout reads it through `Studio["measure"]`.
  get gpu(): number | null {
    return this.#gpu.last;
  }

  /** Counts the frame `draw` draws. */
  frame(draw: () => void): void {
    const { info } = this.#renderer;
    const now = this.#clock();
    const start = performance.now();

    const passes: Pass[] = [];

    info.reset();
    this.#passes = passes;
    this.#bound = undefined;
    this.#gpu.begin();
    draw();
    this.#gpu.end();
    this.#bind(null);
    this.#passes = undefined;
    this.#drawn = [...this.#drawn.filter((at) => at > now - 1000), now];
    this.#last = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      shadows: passes.filter(({ target }) => target === "shadow").length,
      passes,
      script: performance.now() - start,
    };
  }

  dispose(): void {
    this.#restore();
    this.#gpu.dispose();
  }

  /** Closes the pass into what was bound, if it drew, and opens one into `target`. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own target.
  #bind(target: Target | null): void {
    const { calls } = this.#renderer.info.render;
    const bound = this.#bound;
    const passes = this.#passes;

    if (passes === undefined) return;

    if (bound !== undefined && calls > bound.from) {
      passes.push({ ...this.#told(bound.target), calls: calls - bound.from });
    }

    this.#bound = { target, from: calls };
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own target.
  #told(target: Target | null): Omit<Pass, "calls"> {
    if (target === null) {
      const { width, height } = this.#renderer.domElement;

      return { target: "canvas", width, height, samples: 0 };
    }

    return {
      target: target === this.#shadow() ? "shadow" : "target",
      width: target.width,
      height: target.height,
      samples: target.samples,
    };
  }
}
