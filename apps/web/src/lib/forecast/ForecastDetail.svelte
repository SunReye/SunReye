<!--
  The PV forecast sheet (ADR 21 "Details by drilling down"): today and the next two days, a tab
  each. Under the day stand its sunshine and its best window; today alone, how the forecast holds.
  It ends on the Forecast screen, opened on the tab's day.
-->
<script lang="ts" module>
  export type { AheadReader } from "./ahead-read.ts";
</script>

<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import type { Day } from "../dashboard/day.ts";
  import DayTabs from "../detail/DayTabs.svelte";
  import { m } from "../paraglide/messages.js";
  import { readAhead, type Ahead, type AheadReader } from "./ahead-read.ts";
  import { shown } from "./ahead-shown.ts";
  import DayBelow from "./DayBelow.svelte";
  import ForecastDay from "./ForecastDay.svelte";

  let {
    core,
    day: read,
  }: {
    core: AheadReader;
    /** Today as the dashboard read it; undefined until it has. */
    day: Pick<Day, "zone" | "start" | "now" | "rows"> | undefined;
  } = $props();

  const HOUR = 3_600_000;

  /** A sheet section, as the other details' (ADR 21). */
  const FRAME = "flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6";

  const zone = $derived(read?.zone);
  const start = $derived(read?.start.getTime());
  const now = $derived(read?.now.getTime() ?? 0);

  // The hour in progress: the forecast is issued anew as the weather's lands, so each new hour
  // reads again.
  const hour = $derived(read === undefined ? undefined : Math.floor(read.now.getTime() / HOUR));

  /** What was read; null for a plant without a layout, undefined until it is read. */
  let ahead = $state.raw<Ahead | null>();

  $effect(() => {
    if (zone === undefined || start === undefined || hour === undefined) return;

    let current = true;

    void readAhead(core, zone, new Date(start), new Date(hour * HOUR))
      .catch(() => null)
      .then((got) => {
        if (current) ahead = got;

        return got;
      });

    return () => {
      current = false;
    };
  });

  const view = $derived(
    !ahead || read === undefined || zone === undefined
      ? null
      : shown(ahead, read.rows, zone, now),
  );

  /** Whether any day expects anything; undefined until read. */
  const forecast = $derived(
    ahead === undefined ? undefined : (view?.days.some((d) => d.peak !== null) ?? false),
  );
</script>

{#if zone === undefined || view === null || !forecast}
  <section class={FRAME} aria-label={m.ahead_days()}>
    {#if forecast === false}
      <p class="flex h-[190px] items-center justify-center text-xs text-muted-foreground">
        {m.ahead_none()}
      </p>
    {:else}
      <Skeleton class="h-[440px]" role="status" aria-label={m.loading()} />
    {/if}
  </section>
{:else}
  <DayTabs days={view.days} {zone} label={m.ahead_days()} class={FRAME}>
    {#snippet day(of)}
      <ForecastDay
        day={of}
        {now}
        {zone}
        top={view.top}
        linesTitle={ahead?.inputs ? m.ahead_per_input() : m.ahead_per_string()}
      />
    {/snippet}
    {#snippet below(of)}
      <DayBelow day={of} at={view.days.indexOf(of)} track={view.track} {zone} {now} />
    {/snippet}
  </DayTabs>
{/if}
