<!--
  Autarky and self-consumption by band (ADR 21 "Sheet content"): a row of bars each, 0–100 %, on
  one time axis. The pointer, or a finger held on it, reads a band: its title above, its values in
  the rows' headers (ADR 21 "Chart reading"). A band without load or without PV reads "–", never
  0 %. Plain elements, as the price chart's.
-->
<script lang="ts">
  import { flowColour } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import type { Band } from "../range/bands.ts";
  import { num } from "../range/format.ts";
  import type { Grain } from "../range/range.ts";
  import ChartReading from "./ChartReading.svelte";
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";

  let {
    bands,
    grain,
    selfUse,
  }: {
    bands: readonly Band[];
    grain: Grain;
    /** The range's self-consumption, which the head does not state. */
    selfUse: number | null;
  } = $props();

  const BY: Readonly<Record<Grain, () => string>> = {
    hour: m.detail_by_hour,
    day: m.detail_by_day,
    week: m.detail_by_week,
    month: m.detail_by_month,
    year: m.detail_by_year,
  };

  // Autarky is the head's figure, so only self-consumption states the range at rest.
  const ROWS = $derived([
    { side: "up", label: m.dash_autarky(), colour: flowColour("battery"), rest: null },
    { side: "down", label: m.dash_self_use(), colour: flowColour("solar"), rest: selfUse },
  ] as const);

  /** The index of the band being read; null with none. */
  let read = $state<number | null>(null);

  const shown = $derived(read === null ? undefined : bands[read]);

  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? "–" : `${num(v)} %`;

  /** What a band reads on a side: nothing for one without readings yet. */
  const valueOf = (b: Band, side: "up" | "down") =>
    b.state === "data" || b.state === "live" ? (b[side][0] ?? null) : null;
</script>

<figure class="flex flex-col gap-2" aria-label={m.detail_shares_chart()}>
  <p class="text-xs" aria-live="polite">
    {#if shown}
      <span class="font-medium tabular-nums">{shown.title}</span>
    {:else}
      <span class="text-muted-foreground">{BY[grain]()}</span>
    {/if}
  </p>
  <ChartEntrance build="grow" ready={bands.length > 0}>
    <ChartReading slots={bands.length} bind:read class="flex flex-col gap-3" data-plot>
      {#each ROWS as row (row.side)}
        <div class="flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="flex items-center gap-1.5 font-medium">
              <span class="size-2 rounded-[1px]" style:background={row.colour}></span>
              {row.label}
            </span>
            {#if shown}
              <span class="font-medium tabular-nums">{pct(valueOf(shown, row.side))}</span>
            {:else if row.rest !== null}
              <span class="text-muted-foreground tabular-nums">{pct(row.rest)}</span>
            {/if}
          </div>
          <div class="flex h-14 gap-px border-b border-border/60" aria-hidden="true">
            {#each bands as b, i (b.key)}
              {@const v = valueOf(b, row.side)}
              <span class={["relative flex-1", b.state === "gap" && "gap"]}>
                {#if v !== null}
                  <span
                    class={[
                      "absolute inset-x-0 bottom-0 min-h-px origin-bottom rounded-t-[1px]",
                      (b.partial || b.state === "live") && "opacity-60",
                    ]}
                    style:height="{v}%"
                    style:background={row.colour}
                    style:--i={i / bands.length}
                    data-grow
                  ></span>
                {/if}
              </span>
            {/each}
          </div>
        </div>
      {/each}
    </ChartReading>
  </ChartEntrance>
  <div class="relative h-4 text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
    {#each bands as b, i (b.key)}
      {#if b.tick}
        <span class="absolute -translate-x-1/2" style:left="{((i + 0.5) / bands.length) * 100}%"
          >{b.label}</span
        >
      {/if}
    {/each}
  </div>
</figure>

<style>
  /* A band without readings: hatched, so it reads as missing, not as 0 %. */
  .gap {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--foreground) 12%, transparent) 0 1px,
      transparent 1px 4px
    );
  }
</style>
