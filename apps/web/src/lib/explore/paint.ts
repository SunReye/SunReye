// The chart's one canvas (ADR 22): six series of 1,500 points are far too many to mount as
// elements. It executes a scene (`scene.ts`) and draws again when the size or the theme changes.
import { redrawn } from "../canvas-redraw.ts";
import type { Op } from "./scene.ts";

const GRID = "color-mix(in oklab, var(--foreground) 9%, transparent)";

/** A canvas cannot read `var()`: a hidden probe resolves each colour once per draw. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM, used in place.
function solver(canvas: HTMLCanvasElement) {
  const probe = document.createElement("i");
  const seen = new Map<string, string>();

  probe.style.display = "none";
  canvas.after(probe);

  return {
    solve: (css: string): string => {
      let out = seen.get(css);

      if (out === undefined) {
        probe.style.color = css;
        out = getComputedStyle(probe).color;
        seen.set(css, out);
      }

      return out;
    },
    stop: () => {
      probe.remove();
    },
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
function trace(ctx: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
function draw(ctx: CanvasRenderingContext2D, op: Op, solve: (css: string) => string, w: number) {
  ctx.globalAlpha = 1;

  if (op.op === "grid") {
    ctx.fillStyle = solve(GRID);
    ctx.fillRect(0, Math.round(op.y), w, 1);
  } else if (op.op === "rect") {
    ctx.globalAlpha = op.alpha;
    ctx.fillStyle = solve(op.colour);
    ctx.fillRect(op.x, op.y, op.w, op.h);
  } else if (op.op === "area") {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = solve(op.colour);
    trace(ctx, op.points);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = solve(op.colour);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    trace(ctx, op.points);
    ctx.stroke();
  }
}

/** Paints `scene` on `canvas`, in CSS px, until the returned stop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is drawn on.
export function paintScene(canvas: HTMLCanvasElement, scene: readonly Op[]): () => void {
  const ctx = canvas.getContext("2d");

  if (!ctx) return () => {};

  const colours = solver(canvas);

  const redraw = () => {
    const [w, h] = [canvas.clientWidth, canvas.clientHeight];
    const dpr = Math.min(2, devicePixelRatio || 1);

    if (!w || !h) return;

    [canvas.width, canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const op of scene) draw(ctx, op, colours.solve, w);
  };

  const stop = redrawn(canvas, redraw);

  return () => {
    stop();
    colours.stop();
  };
}
