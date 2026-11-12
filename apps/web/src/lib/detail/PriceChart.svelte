<!--
  Today's spot prices as the prototype's bar chart: one bar per slot, the slot in force solid. A
  negative price hangs below the zero line (ADR 12). Hours are the plant's, and the source's CC BY
  attribution sits under the chart it licenses.
-->
<script lang="ts">
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import SpotAttribution from "../SpotAttribution.svelte";

  let { day }: { day: Day | undefined } = $props();

  const height = 190;

  const HOUR = 3_600_000;

  const prices = $derived(day?.prices ?? []);
  const top = $derived(Math.max(0, ...prices.map((p) => p.value)));
  const bottom = $derived(Math.min(0, ...prices.map((p) => p.value)));
  const span = $derived(top - bottom || 1);
  /** The zero line, as a share of the height from the top. */

  const zero = $derived((top / span) * 100);

  const now = $derived(day?.now.getTime() ?? 0);
  /** The slot in force: the last that began. */

  const inForce = $derived(prices.findLastIndex((p) => Date.parse(p.target) <= now));

  const hours = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day?.zone,
    }),
  );

  /** Every six hours from the plant's midnight. */
  const ticks = $derived(
    day === undefined
      ? []
      : [0, 6, 12, 18].map((h) => {
          const at = day.start.getTime() + h * HOUR;

          return {
            at,
            left: ((at - day.start.getTime()) / (day.end.getTime() - day.start.getTime())) * 100,
          };
        }),
  );
</script>

<figure class="flex flex-col gap-1.5">
  {#if prices.length === 0}
    <!-- The chart's place is held: nothing below it moves when the prices land. -->
    <p
      class="flex items-center justify-center text-xs text-muted-foreground"
      style:height="{height}px"
    >
      {day === undefined ? "" : m.detail_no_prices()}
    </p>
  {:else}
    <div class="relative" style:height="{height}px" role="img" aria-label={m.detail_prices()}>
      <div class="absolute inset-0 flex gap-[3px]">
        {#each prices as p, i (p.target)}
          <span class="relative flex-1" data-price={p.value} data-now={i === inForce || undefined}>
            <span
              class={[
                "absolute inset-x-0 rounded-sm",
                i === inForce ? "bg-foreground" : "bg-foreground/25",
              ]}
              style:top="{p.value >= 0 ? zero - (p.value / span) * 100 : zero}%"
              style:height="{(Math.abs(p.value) / span) * 100}%"
            ></span>
          </span>
        {/each}
      </div>
      {#if bottom < 0}
        <span class="absolute inset-x-0 h-px bg-foreground/30" style:top="{zero}%"></span>
      {/if}
    </div>
    <div class="relative h-4 text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
      {#each ticks as tick (tick.at)}
        <span class="absolute" style:left="{tick.left}%">{hours.format(tick.at)}</span>
      {/each}
    </div>
  {/if}
  <figcaption>
    <SpotAttribution class="text-[11px] leading-snug text-muted-foreground [&_a]:underline" />
  </figcaption>
</figure>
