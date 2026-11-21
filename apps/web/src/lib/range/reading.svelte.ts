// The band chart's reading (ADR 21): the core's pointer reading, a place being a band's index. Keys
// start from the band being read, or the latest that has happened.
import { ChartReader, type Move } from "../chart-reading/reader.svelte.ts";
import type { Band } from "./bands.ts";

/** What the chart reads from its caller at the moment of an input. */
export interface Target {
  readonly bands: readonly Band[];
  readonly ondrill?: ((index: number) => void) | undefined;
  readonly onbrush?: ((from: number, to: number) => void) | undefined;
  /** Told the band being read, as it changes, for a chart that reads along. */
  readonly onread?: ((index: number | null) => void) | undefined;
}

const clamp = (v: number, last: number) => Math.min(last, Math.max(0, v));

function step(bands: readonly Band[], from: number | null, key: Move): number | undefined {
  const last = bands.length - 1;

  const now = Math.max(
    0,
    bands.findLastIndex((b) => b.state === "data" || b.state === "live"),
  );

  if (key === "Home") return 0;

  if (key === "End") return last;

  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;

  if (from === null) return now;

  return clamp(from + (key === "ArrowLeft" ? -1 : 1), last);
}

export function bandReading(target: () => Target): ChartReader<number> {
  let active = $state<number | null>(null);

  return new ChartReader(
    () => {
      const { bands, ondrill, onbrush } = target();

      return {
        over: (x) => clamp(Math.floor(x * bands.length), bands.length - 1),
        band: (i) => i,
        step: (from, key) => step(bands, from, key),
        drill: (i) => {
          if (bands[i]?.drillable !== true || !ondrill) return false;

          ondrill(i);

          return true;
        },
        brush:
          onbrush &&
          ((a, b) => {
            const [from, to] = [Math.min(a, b), Math.max(a, b)];

            if (to <= from) return false;

            onbrush(from, to);

            return true;
          }),
      };
    },
    {
      store: {
        get: () => active,
        set: (i) => {
          active = i;
          target().onread?.(i);
        },
      },
    },
  );
}
