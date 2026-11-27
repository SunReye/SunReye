<!-- Today's small day chart, actual against forecast; a press opens the day's details. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import { Skeleton } from "../components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Day } from "./day.ts";
  import DayChart from "./DayChart.svelte";

  let {
    day,
    hours,
    onopen,
  }: {
    day: Day | undefined;
    /** The plant-local clock the axis is written in. */
    hours: Intl.DateTimeFormat;
    onopen: () => void;
  } = $props();
</script>

<Pressable
  feedback
  class="flex min-h-0 flex-col gap-1 border-t border-border/60 px-4 pt-3 pb-2 text-left max-lg:h-52 lg:min-h-[132px] lg:flex-1"
  onclick={onopen}
  aria-label={m.dash_day_details()}
>
  <span class="flex shrink-0 items-center gap-3 text-xs">
    <span class="font-medium text-muted-foreground">{m.dash_day()}</span>
    <span class="flex items-center gap-1.5 text-muted-foreground">
      <span class="h-0.5 w-3 bg-solar"></span>{m.dash_actual()}
    </span>
    <span class="flex items-center gap-1.5 text-muted-foreground">
      <span class="h-0 w-3 border-t border-dashed border-solar"></span>{m.dash_forecast()}
    </span>
    <span class="ml-auto text-muted-foreground">kW</span>
  </span>
  <span class="relative block min-h-0 w-full flex-1">
    {#if day === undefined}
      <Skeleton class="absolute inset-0" role="status" aria-label={m.loading()} />
    {:else}
      <span class="absolute inset-0"><DayChart rows={day.rows} now={day.now} {hours} live /></span>
    {/if}
  </span>
</Pressable>
