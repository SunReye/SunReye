<!--
  The PV forecast sheet (ADR 21 "Details by drilling down"): today and the next two days, a tab
  each. Under the day stand its sunshine and its best window; today alone, how the forecast holds.
  It ends on the Forecast screen, opened on the tab's day.
-->
<script lang="ts" module>
  export type { AheadReader } from "./ahead-read.ts";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import type { Day } from "../dashboard/day.ts";
  import DayTabs from "../detail/DayTabs.svelte";
  import { m } from "../paraglide/messages.js";
  import { readAhead, type AheadReader } from "./ahead-read.ts";
  import { shown } from "./ahead-shown.ts";
  import DayBelow from "./DayBelow.svelte";
  import ForecastDay from "./ForecastDay.svelte";

  let {
    core,
    day,
  }: {
    core: AheadReader;
    /** Today as the dashboard read it; undefined until it has. */
    day: Pick<Day, "zone" | "start" | "now" | "rows"> | undefined;
  } = $props();

  const HOUR = 3_600_000;

  /** A sheet section, as the other details' (ADR 21). */
  const FRAME = "flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6";

  /** A day's tabs, chart and facts at a phone's width, in px: the placeholder's, loading or empty. */
  const DAYS_HEIGHT = 436;

  const zone = $derived(day?.zone);
  const start = $derived(day?.start.getTime());
  const now = $derived(day?.now.getTime() ?? 0);

  // The hour in progress: the forecast is issued anew as the weather's lands, so each new hour
  // reads again.
  const hour = $derived(day === undefined ? undefined : Math.floor(day.now.getTime() / HOUR));

  /** What was read; null for a plant without a layout, undefined until it is read. */
  let read = $state.raw<Awaited<ReturnType<typeof readAhead>>>();

  const ahead = $derived(read === undefined || read.failed ? undefined : read.data);

  /** Raised to read again after a failure. */
  let again = $state(0);

  $effect(() => {
    if (zone === undefined || start === undefined || hour === undefined) return;

    void again;

    let current = true;

    // Read as of the dashboard's last read, which the figures of what was measured stand for.
    // Neither it nor the core reads again inside the hour: the sheet hands the same core over
    // anew as its own reads land.
    const [reader, asOf] = untrack(() => [core, day?.now.getTime() ?? hour * HOUR]);

    void readAhead(reader, zone, new Date(start), new Date(asOf)).then((got) => {
      if (current) read = got;

      return got;
    });

    return () => {
      current = false;
    };
  });

  const view = $derived(
    !ahead || day === undefined || zone === undefined ? null : shown(ahead, day.rows, zone, now),
  );

  /** Whether any day expects anything; undefined until read. */
  const forecast = $derived(
    ahead === undefined ? undefined : (view?.days.some((d) => d.peak !== null) ?? false),
  );
</script>

{#if zone === undefined || view === null || !forecast}
  <section class={FRAME} aria-label={m.ahead_days()}>
    {#if read?.failed}
      <div class="flex flex-col justify-center" style:height="{DAYS_HEIGHT}px">
        <LoadFailed
          text={m.ahead_unread()}
          refused={read.refused}
          onretry={() => {
            read = undefined;
            again++;
          }}
        />
      </div>
    {:else if forecast === false}
      <p
        class="flex items-center justify-center text-xs text-muted-foreground"
        style:height="{DAYS_HEIGHT}px"
      >
        {m.ahead_none()}
      </p>
    {:else}
      <Skeleton style="height: {DAYS_HEIGHT}px" role="status" aria-label={m.loading()} />
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
