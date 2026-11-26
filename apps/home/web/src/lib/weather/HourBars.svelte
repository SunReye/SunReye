<!-- A day's precipitation as one bar per hour (ADR 23 "Dashboard"): an hour of snow in the snow's
  colour. Plain elements, as the price chart's: bands by the dozen stall a chart library. -->
<script lang="ts" module>
  /** What falls as snow; rain is `RAIN`. */
  export const SNOW = "var(--chart-3)";

  const RAIN = "var(--chart-2)";
</script>

<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import type { Hour } from "./hourly.ts";

  let { hours, label }: { hours: readonly Hour[]; label: string } = $props();

  /** mm in an hour that fill the row; a wetter hour raises it. */
  const FULL = 2;

  const top = $derived(Math.max(FULL, ...hours.map((h) => h.precipitation ?? 0)));
</script>

<ChartEntrance build="grow" ready={hours.length > 0} class="h-12 w-full">
  <div class="flex size-full gap-px" role="img" aria-label={label}>
    {#each hours as hour, i (hour.at)}
      {@const snow = (hour.snowfall ?? 0) > 0}
      {@const mm = hour.precipitation ?? 0}
      <span
        class="relative flex-1"
        data-hour={hour.at}
        data-mm={hour.precipitation}
        data-snow={snow || undefined}
      >
        {#if mm > 0}
          <span
            class="absolute inset-x-0 bottom-0 min-h-px origin-bottom rounded-t-[1px]"
            style:height="{(mm / top) * 100}%"
            style:background={snow ? SNOW : RAIN}
            style:--i={i / hours.length}
            data-grow
          ></span>
        {/if}
      </span>
    {/each}
  </div>
</ChartEntrance>
