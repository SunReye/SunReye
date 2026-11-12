<!-- The year by month against the year before. Independent of the range's length: it reads the range's year. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { yearOf } from "../range/calendar.ts";
  import { kwh, money, num } from "../range/format.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import type { StatsCore } from "./stats.svelte.ts";
  import type { Metric } from "./view.ts";
  import { readYears, yearBands, yearTotal, type Years } from "./years.ts";

  let {
    core,
    route,
    metric,
    fresh,
    height,
  }: {
    core: StatsCore;
    route: RangeRoute;
    metric: Metric;
    /** Recording began days ago. */
    fresh: boolean;
    height: number;
  } = $props();

  let got = $state.raw<Years | undefined>();

  $effect(() => {
    const r: RangeRoute = route;
    const [range, { zone, cal }] = [r.range, r.place];
    let live = true;

    void readYears(core, zone, cal, range).then((next) => {
      if (live) got = next;

      return next;
    });

    return () => {
      live = false;
    };
  });

  const spec = $derived(
    metric === "money"
      ? { name: m.stats_savings(), colour: "var(--e-solar)", fmt: money, unit: "€", max: undefined }
      : metric === "autarky"
        ? {
            name: m.stats_autarky(),
            colour: "var(--e-battery)",
            fmt: (v: number) => `${num(v)} %`,
            unit: "%",
            max: 100,
          }
        : {
            name: m.stats_production(),
            colour: "var(--e-solar)",
            fmt: kwh,
            unit: "kWh",
            max: undefined,
          },
  );

  const year = $derived(got ? yearOf(got.year.range.from) : 0);
  const bands = $derived(got ? yearBands(metric, got) : []);
</script>

{#if fresh}
  <div class="flex min-h-[300px] flex-col justify-center gap-2 px-1">
    <h3 class="text-base font-semibold">{m.stats_years_fresh()}</h3>
    <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_years_fresh_text()}</p>
  </div>
{:else}
  <BandChart
    {bands}
    up={[{ label: `${spec.name} ${year}`, colour: spec.colour }]}
    markLabel={bands.some((b) => b.mark != null) ? String(year - 1) : ""}
    summary={{
      title: m.stats_years_sum({ year }),
      up: [got ? yearTotal(metric, got) : 0],
      down: [],
    }}
    fmt={spec.fmt}
    unit={spec.unit}
    max={spec.max}
    {height}
    loading={!got}
    drillLabel={m.stats_drill_month()}
    label={m.stats_years_chart({ name: spec.name, year })}
    ondrill={(i) => {
      const drill = got?.list[i]?.drill;

      if (drill) route.open(drill);
    }}
  />
{/if}
