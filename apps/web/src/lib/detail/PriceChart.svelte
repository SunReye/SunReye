<!--
  Today's spot prices as the prototype's bar chart: one bar per plant hour, the mean of its known
  quarter-hour slots, the hour in force solid. An hour without a slot is a gap, never 0, and a
  negative price hangs below the zero line (ADR 12). The pointer reads an hour's price in the
  legend (ADR 21 "Chart reading"). The source's CC BY attribution sits under the chart it licenses.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import SpotAttribution from "../SpotAttribution.svelte";
  import { ctPerKwh } from "../tariff/format.ts";
  import ChartReading from "./ChartReading.svelte";
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";

  let { day }: { day: Day | undefined } = $props();

  const HOUR = 3_600_000;
  const HEIGHT = 190;

  const prices = $derived(day?.prices ?? []);

  /** Each plant hour of the day and its mean price; `undefined` where no slot is known. */
  const bars = $derived.by(() => {
    if (day === undefined) return [];
    const out: { at: number; price: number | undefined }[] = [];

    for (let at = day.start.getTime(); at < day.end.getTime(); at += HOUR) {
      const known = prices
        .filter((p) => {
          const t = Date.parse(p.target);

          return t >= at && t < at + HOUR;
        })
        .map((p) => p.value);

      out.push({
        at,
        price: known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0) / known.length,
      });
    }

    return out;
  });

  const known = $derived(bars.flatMap((b) => (b.price === undefined ? [] : [b.price])));
  const top = $derived(Math.max(0, ...known));
  const bottom = $derived(Math.min(0, ...known));
  const span = $derived(top - bottom || 1);

  /** The zero line, as a share of the height from the top. */
  const zero = $derived((top / span) * 100);

  const now = $derived(day?.now.getTime() ?? 0);

  /** The hour in force. */
  const inForce = $derived(bars.findIndex((b) => b.at <= now && now < b.at + HOUR));

  const hours = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: day?.zone,
    }),
  );

  /** The plant-local hour of an instant, 0–23. */
  const hourOf = $derived(
    new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: day?.zone }),
  );

  /** The index of the hour being read; null with none. */
  let read = $state<number | null>(null);

  const shown = $derived(read === null ? undefined : bars[read]);

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
  {#if day === undefined}
    <Skeleton style="height: {HEIGHT}px" role="status" aria-label={m.loading()} />
  {:else if prices.length === 0}
    <!-- The chart's place is held: nothing below it moves when the prices land. -->
    <p
      class="flex items-center justify-center text-xs text-muted-foreground"
      style:height="{HEIGHT}px"
    >
      {m.detail_no_prices()}
    </p>
  {:else}
    <div class="flex items-baseline justify-between gap-3 text-xs" aria-live="polite">
      {#if shown}
        {@const hour = Number(hourOf.format(shown.at))}
        <span class="font-medium tabular-nums">{m.range_hours({ from: hour, to: hour + 1 })}</span>
        <span class="font-semibold tabular-nums">{ctPerKwh(shown.price)}</span>
      {:else}
        <span class="text-muted-foreground">{m.detail_prices()}</span>
      {/if}
    </div>
    <ChartReading
      slots={bars.length}
      bind:read
      style="height: {HEIGHT}px"
      role="img"
      aria-label={m.detail_prices()}
      data-plot
    >
      <ChartEntrance build="grow" ready={known.length > 0} class="absolute inset-0">
        <div class="absolute inset-0 flex gap-[3px]">
          {#each bars as bar, i (bar.at)}
            <span
              class="relative flex-1"
              data-hour={bar.at}
              data-price={bar.price}
              data-now={(i === inForce && bar.price !== undefined) || undefined}
            >
              {#if bar.price !== undefined}
                <span
                  class={[
                    "absolute inset-x-0 rounded-sm",
                    bar.price >= 0 ? "origin-bottom" : "origin-top",
                    i === inForce ? "bg-foreground" : "bg-foreground/25",
                  ]}
                  style:top="{bar.price >= 0 ? zero - (bar.price / span) * 100 : zero}%"
                  style:height="{(Math.abs(bar.price) / span) * 100}%"
                  style:--i={i / bars.length}
                  data-grow
                ></span>
              {/if}
            </span>
          {/each}
        </div>
      </ChartEntrance>
      {#if bottom < 0}
        <span class="absolute inset-x-0 h-px bg-foreground/30" style:top="{zero}%"></span>
      {/if}
    </ChartReading>
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
