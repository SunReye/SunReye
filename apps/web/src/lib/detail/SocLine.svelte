<!--
  The battery's state of charge as a line under its power (ADR 21 "Sheet content"): a band's mean,
  0–100 %, in the power chart's columns, so each point stands under its bar. It reads the band
  under the pointer, its own or the power chart's, in its header (ADR 21 "Chart reading"). A band
  without readings breaks the line, never 0 %.
-->
<script lang="ts">
  import { flowColour } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import type { Band } from "../range/bands.ts";
  import { num } from "../range/format.ts";
  import ChartReading from "./ChartReading.svelte";

  let {
    bands,
    read = $bindable(null),
  }: {
    bands: readonly Band[];
    /** The index of the band being read here or on the power chart; null with none. */
    read?: number | null;
  } = $props();

  const COLOUR = flowColour("battery");

  /** A band's state of charge; null for one without readings yet. */
  const socOf = (b: Band | undefined): number | null =>
    b !== undefined && (b.state === "data" || b.state === "live") ? (b.up[0] ?? null) : null;

  /** The line through each band's middle, broken where a band has no reading. */
  const path = $derived(
    bands
      .map((b, i) => {
        const v = socOf(b);

        if (v === null) return "";

        const joined = socOf(bands[i - 1]) !== null;

        return `${joined ? "L" : "M"}${i + 0.5} ${100 - v}${joined ? "" : "h0"}`;
      })
      .join(""),
  );

  const shown = $derived(read === null ? undefined : bands[read]);
</script>

<div class="flex flex-col gap-1.5" role="group" aria-label={m.rd_soc()}>
  <div class="flex items-baseline justify-between gap-3 pl-10 text-xs" aria-live="polite">
    <span class="flex items-center gap-1.5 font-medium">
      <span class="h-0.5 w-3 rounded-full" style:background={COLOUR}></span>
      {m.rd_soc()}
    </span>
    {#if shown}
      {@const v = socOf(shown)}
      <span class="font-medium tabular-nums">{v === null ? "–" : `${num(v)} %`}</span>
    {/if}
  </div>
  <div class="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1">
    <div
      class="relative h-14 text-right text-[11px] leading-none text-muted-foreground tabular-nums"
      aria-hidden="true"
    >
      <span class="absolute inset-x-0 top-0 -translate-y-1/2">100</span>
      <span class="absolute inset-x-0 bottom-0 translate-y-1/2">0</span>
    </div>
    <ChartReading
      slots={bands.length}
      bind:read
      class="h-14 border-y border-dashed border-border/60"
      data-plot
    >
      <svg
        class="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 {Math.max(1, bands.length)} 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={path}
          fill="none"
          stroke={COLOUR}
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </ChartReading>
  </div>
</div>
