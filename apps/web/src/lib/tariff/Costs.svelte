<!--
  Savings and costs over the route's range, a band per day, week or month, from the core's
  plant-local days (ADR 12): savings above the baseline, the import bill below it. The savings
  sheet's chart leaves the standing charge out, and reads a day by its hours (ADR 21).
-->
<script lang="ts">
  import { untrack } from "svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core } from "../api/core";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { money } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { costsOver } from "./cost-hours.ts";
  import { COST_CHARTS, costBands } from "./costs.ts";

  let {
    core,
    route,
    chart = "costs",
  }: {
    core: Readonly<Pick<Core, "costs" | "statistics">>;
    route: RangeRoute;
    chart?: keyof typeof COST_CHARTS;
  } = $props();

  const laid = $derived(COST_CHARTS[chart]());

  // Costs come by the day, so a day is one band; the savings sheet reads a range of hours, as a day
  // or a brush on one, by the tariff's hours.
  const data = new RangeData(
    () => route,
    (from, to) => costsOver(core, laid.hourly, route.range, [from, to]),
    // A chart keeps its kind for its life.
    untrack(() => COST_CHARTS[chart]().hourly) ? "hour" : "day",
  );

  const view = $derived.by(() => {
    const got = data.current;

    if (!got) return null;

    if ("problem" in got.data)
      return { problem: got.data.problem, bands: [], total: laid.sides() };

    return {
      problem: null,
      bands: bandsOf(got.list, costBands(got.data.days, got.spans, got.now, laid.sides)),
      total: laid.sides(got.data.total),
    };
  });
</script>

{#if view?.problem}
  <ProblemAlert problem={view.problem} />
{:else}
  <BandChart
    bands={view?.bands ?? []}
    up={laid.up}
    down={laid.down}
    groups={laid.groups}
    via={data.current?.via}
    summary={{ title: data.title, ...(view?.total ?? laid.sides()) }}
    fmt={money}
    unit="€"
    loading={!view}
    label={laid.label}
    ondrill={data.drill}
    onbrush={data.brush}
  />
{/if}
