// Reading a chart along its time axis (ADR 21), on the one pointer reading (`chart-reading/`): a
// place is an instant. The axis reads in 48 bands, an arrow key's step, so a finger ticks as it
// crosses one, not with every px. A chart that cannot narrow only reads.
import { ChartReader, type Move } from "../chart-reading/reader.svelte.ts";

/** What the chart reads from its caller at the moment of an input. */
export interface Target {
  /** The time axis, [from, to) in epoch ms. */
  readonly from: number;
  readonly to: number;
  /** Narrows to the span between two instants; null on a chart that only reads. */
  readonly onbrush: ((a: number, b: number) => void) | null;
}

/** How many bands the axis reads in. */
const BANDS = 48;

/** A time axis's reading: a place is an instant. */
export type TimeReading = ChartReader<number>;

/** An arrow's step from `at`, or from the middle with none read; undefined for any other key. */
function step({ from, to }: Target, at: number | null, key: Move): number | undefined {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;

  const was = at ?? (from + to) / 2;
  const next = was + ((key === "ArrowLeft" ? -1 : 1) * (to - from)) / BANDS;

  return Math.min(to, Math.max(from, next));
}

export function timeReading(target: () => Target): TimeReading {
  return new ChartReader(() => {
    const t = target();
    const { from, to, onbrush } = t;

    return {
      over: (x) => from + x * (to - from),
      band: (at) => Math.min(BANDS - 1, Math.floor(((at - from) / (to - from)) * BANDS)),
      step: (at, key) => step(t, at, key),
      brush:
        onbrush === null
          ? undefined
          : (a, b) => {
              if (a === b) return false;

              onbrush(a, b);

              return true;
            },
    };
  });
}
