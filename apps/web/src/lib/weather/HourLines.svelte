<!-- One quantity of a day as lines over its hours (ADR 23 "Dashboard"): a gap where an hour has
  no value. It has no axis; its row says the day's range. -->
<script lang="ts" module>
  import { flowColour } from "../energy-colours.ts";
  import type { Hour } from "./hourly.ts";

  /** What the sun warms: the temperature and the clear-sky index. */
  export const WARM = flowColour("solar");

  export const PLAIN = "var(--muted-foreground)";

  /** The quantities of an hour a line can follow. */
  export type Quantity = Exclude<keyof Hour, "at" | "sky">;

  export interface Line {
    readonly of: Quantity;
    readonly colour: string;
    /** A second reading of the row's quantity, such as the apparent temperature. */
    readonly dashed?: boolean;
    /** Filled down to the row's floor. */
    readonly filled?: boolean;
  }
</script>

<script lang="ts">
  import { curveMonotoneX } from "d3-shape";
  import { Area, Chart, Layer, Spline } from "layerchart";

  let {
    hours,
    span,
    lines,
    domain,
    label,
  }: {
    hours: readonly Hour[];
    /** The day, ms since 1970: the hours sit where the other rows' columns do. */
    span: readonly [number, number];
    lines: readonly Line[];
    /** The value range; the day's own where none is given. */
    domain?: readonly [number, number];
    label: string;
  } = $props();

  const HALF = 1_800_000;

  /** Each hour at its middle. */
  const rows = $derived(hours.map((h) => ({ ...h, time: new Date(h.at + HALF) })));

  const own = $derived.by((): [number, number] => {
    const values = hours.flatMap((h) => lines.flatMap(({ of }) => h[of] ?? []));
    const [low, high] = [Math.min(...values), Math.max(...values)];

    // A flat or empty day still has a height to draw in.
    return values.length === 0 ? [0, 1] : [low - 0.5, high + 0.5];
  });

  const range = $derived(domain ?? own);
</script>

<div class="h-12 w-full" role="img" aria-label={label}>
  <Chart
    data={rows}
    x="time"
    y={lines[0]?.of}
    xDomain={[new Date(span[0]), new Date(span[1])]}
    yDomain={[...range]}
    padding={{ top: 3, bottom: 3, left: 0, right: 0 }}
  >
    <Layer type="svg">
      {#each lines as line (line.of)}
        {#if line.filled}
          <Area
            y1={line.of}
            curve={curveMonotoneX}
            defined={(d: Hour) => d[line.of] !== null}
            fill={line.colour}
            fillOpacity={0.18}
            line={{ stroke: line.colour, "stroke-width": 1.5 } as never}
          />
        {:else}
          <Spline
            y={line.of}
            curve={curveMonotoneX}
            defined={(d: Hour) => d[line.of] !== null}
            stroke={line.colour}
            fill="none"
            stroke-width={1.5}
            opacity={line.dashed ? 0.7 : 1}
            stroke-dasharray={line.dashed ? "3 4" : undefined}
          />
        {/if}
      {/each}
    </Layer>
  </Chart>
</div>
