<!-- What stands still under a day of the PV forecast sheet (ADR 21 "Details by drilling down"):
  its sunshine and its best window, today alone how the forecast holds, then the way on to the
  Forecast screen on that day. -->
<script lang="ts">
  import DetailStats from "../detail/DetailStats.svelte";
  import OnwardLink from "../detail/OnwardLink.svelte";
  import { dayFacts, holdFacts, onward } from "./ahead-facts.ts";
  import type { ShownDay } from "./ahead-shown.ts";
  import type { Track } from "./ahead.ts";

  let {
    day,
    at,
    track,
    zone,
    now,
  }: {
    day: ShownDay;
    /** Which of the sheet's days it is: 0 today. */
    at: number;
    track: Track;
    zone: string;
    /** ms since 1970. */
    now: number;
  } = $props();

  const stats = $derived(dayFacts(day, day.sunshine));
  const link = $derived(onward(zone, now, at, day.start));
</script>

{#if stats.length > 0}
  <div data-day-facts><DetailStats {stats} /></div>
{/if}
{#if at === 0}
  <div data-track><DetailStats stats={holdFacts(track)} /></div>
{/if}
<OnwardLink href={link.href}>{link.label}</OnwardLink>
