// The heat grid's one canvas (ADR 11): a cell per column and hour, redrawn when the cells, the
// size or the theme change. A month of hours is 744 cells, too many to mount as elements.

/** What the canvas draws: `[col][hour]`, null hatched unless `hatch` is off, NaN left empty. */
export interface Painting {
  readonly cells: readonly (readonly (number | null)[])[];
  readonly colour: (v: number) => string;
  readonly hatch: boolean;
}

const HATCH = "color-mix(in oklab, var(--foreground) 14%, transparent)";

class Painter {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  /** A canvas cannot read `var()`: a hidden probe resolves each colour once per draw. */
  readonly #probe = document.createElement("i");
  readonly #seen = new Map<string, string>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#probe.style.display = "none";
    canvas.after(this.#probe);
  }

  #solve(css: string): string {
    let out = this.#seen.get(css);

    if (out === undefined) {
      this.#probe.style.color = css;
      out = getComputedStyle(this.#probe).color;
      this.#seen.set(css, out);
    }

    return out;
  }

  /** No readings: hatched, so it never reads as zero. */
  #hatch(x: number, y: number, w: number, h: number): void {
    const ctx = this.#ctx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = this.#solve(HATCH);
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let d = -h; d < w + h; d += 4) {
      ctx.moveTo(x + d, y + h);
      ctx.lineTo(x + d + h, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  draw(what: Painting): void {
    const [canvas, ctx] = [this.#canvas, this.#ctx];
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    const dpr = Math.min(2, devicePixelRatio || 1);

    if (!w || !h) return;

    this.#seen.clear();
    [canvas.width, canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cw = (w - (what.cells.length - 1)) / what.cells.length;
    const ch = (h - 23) / 24;

    what.cells.forEach((col, c) => {
      col.forEach((v, hr) => {
        const [x, y] = [c * (cw + 1), hr * (ch + 1)];

        if (v !== null && !Number.isNaN(v)) {
          ctx.fillStyle = this.#solve(what.colour(v));
          ctx.fillRect(x, y, cw, ch);
        } else if (v === null && what.hatch) this.#hatch(x, y, cw, ch);
      });
    });
  }

  stop(): void {
    this.#probe.remove();
  }
}

/** Paints `what` on `canvas` until the returned stop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
export function paintHeat(canvas: HTMLCanvasElement, what: Painting): () => void {
  const ctx = canvas.getContext("2d");

  if (!ctx) return () => {};

  const painter = new Painter(canvas, ctx);

  const redraw = () => {
    painter.draw(what);
  };

  const stop = repainted(canvas, redraw);

  return () => {
    stop();
    painter.stop();
  };
}

/** Calls `redraw` now and when the canvas' size or the theme changes, until the returned stop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is observed.
export function repainted(canvas: HTMLCanvasElement, redraw: () => void): () => void {
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
