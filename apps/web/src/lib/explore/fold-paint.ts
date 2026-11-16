// The fold chart's one canvas (ADR 22): a bar per period on the time axis, with its min–max
// whisker. A month of hours is 744 bars, too many to mount as elements; redrawn when the bars, the
// size or the theme change.
import { redrawn } from "../canvas-redraw.ts";
import { place, type Scale } from "../range/bands.ts";

/** A bar: its span as shares of the plot's width, its value, and its whisker's ends. */
export interface Bar {
  readonly x0: number;
  readonly x1: number;
  readonly value: number;
  readonly min: number | null;
  readonly max: number | null;
}

export interface FoldPainting {
  readonly bars: readonly Bar[];
  readonly scale: Scale;
  /** The gridlines' values. */
  readonly lines: readonly number[];
}

const BAR = "var(--chart-1)";
const WHISKER = "color-mix(in oklab, var(--foreground) 62%, transparent)";
const GRID = "color-mix(in oklab, var(--foreground) 10%, transparent)";
const ZERO = "color-mix(in oklab, var(--foreground) 32%, transparent)";

/** A canvas cannot read `var()`: a hidden probe resolves a colour. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the probe is put after it.
function solver(canvas: HTMLCanvasElement) {
  const probe = document.createElement("i");

  probe.style.display = "none";
  canvas.after(probe);

  return {
    solve: (css: string): string => {
      probe.style.color = css;

      return getComputedStyle(probe).color;
    },
    stop: () => {
      probe.remove();
    },
  };
}

type Y = (v: number) => number;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
function whisker(ctx: CanvasRenderingContext2D, b: Bar, y: Y, w: number, room: number): void {
  if (b.min === null || b.max === null) return;

  const mid = Math.round(((b.x0 + b.x1) / 2) * w);
  const cap = Math.min(4, room / 4);

  ctx.fillRect(mid, y(b.max), 1, Math.max(1, y(b.min) - y(b.max)));

  if (cap < 1.5) return;

  ctx.fillRect(mid - cap, y(b.max), cap * 2 + 1, 1);
  ctx.fillRect(mid - cap, y(b.min), cap * 2 + 1, 1);
}

function draw(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
  ctx: CanvasRenderingContext2D,
  solve: (css: string) => string,
  what: FoldPainting,
): void {
  const [w, h] = [canvas.clientWidth, canvas.clientHeight];
  const dpr = Math.min(2, devicePixelRatio || 1);

  if (!w || !h) return;

  [canvas.width, canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { upMax, span } = what.scale;
  const y: Y = (v) => (place(v, upMax, span) / 100) * h;

  for (const v of what.lines) {
    ctx.fillStyle = solve(v === 0 ? ZERO : GRID);
    ctx.fillRect(0, Math.min(h - 1, Math.round(y(v))), w, 1);
  }

  const [bar, line] = [solve(BAR), solve(WHISKER)];

  for (const b of what.bars) {
    const [left, right] = [b.x0 * w, b.x1 * w];
    const gap = Math.min(2, (right - left) * 0.2);
    const room = Math.max(1, right - left - gap);
    const [top, foot] = [Math.min(y(b.value), y(0)), Math.max(y(b.value), y(0))];

    ctx.fillStyle = bar;
    ctx.fillRect(left + gap / 2, top, room, Math.max(1, foot - top));
    ctx.fillStyle = line;
    whisker(ctx, b, y, w, room);
  }
}

/** Paints `what` on `canvas` until the returned stop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
export function paintFold(canvas: HTMLCanvasElement, what: FoldPainting): () => void {
  const ctx = canvas.getContext("2d");

  if (!ctx) return () => {};

  const { solve, stop } = solver(canvas);

  const still = redrawn(canvas, () => {
    draw(canvas, ctx, solve, what);
  });

  return () => {
    still();
    stop();
  };
}
