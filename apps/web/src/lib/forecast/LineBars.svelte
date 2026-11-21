<!-- Each string's or MPPT input's expected energy on a day of the PV forecast sheet, as a small
  bar (ADR 21 "Details by drilling down"): the widest stands for the most any makes on any day. -->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import { kwh } from "../range/format.ts";
  import type { AheadDay } from "./ahead.ts";

  let {
    title,
    lines,
    top,
  }: {
    /** What the lines are: strings or MPPT inputs. */
    title: string;
    lines: AheadDay["lines"];
    /** The full bar, in kWh. */
    top: number;
  } = $props();
</script>

<div class="flex flex-col gap-2">
  <h3 class="text-xs font-medium">{title}</h3>
  <ChartEntrance build="grow" ready={lines.length > 0}>
    <ul class="grid grid-cols-[minmax(0,auto)_1fr_auto] items-center gap-x-3 gap-y-1.5 text-xs">
      {#each lines as line, i (i)}
        <li class="col-span-3 grid grid-cols-subgrid items-center" data-line>
          <span class="max-w-32 truncate text-muted-foreground">{line.label}</span>
          <span class="h-1.5 rounded-full bg-foreground/[0.06]" aria-hidden="true">
            <span
              class="block h-full min-w-px origin-left rounded-full"
              style:width="{top > 0 ? (line.kwh / top) * 100 : 0}%"
              style:background={line.colour}
              style:--i={i / lines.length}
              data-bar
              data-grow="x"
            ></span>
          </span>
          <span class="tabular-nums">{kwh(line.kwh)}</span>
        </li>
      {/each}
    </ul>
  </ChartEntrance>
</div>
