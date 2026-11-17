<!--
  Savings and costs over the route's range, a band per day, week or month, from the core's
  plant-local days (ADR 12): savings above the baseline, the import bill below it. The savings
  sheet's chart leaves the standing charge out (ADR 21).
-->
<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core } from "../api/core";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { money } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { COST_CHARTS, costBands } from "./costs.ts";

  let {
    core,
    route,
    chart = "costs",
  }: {
    core: Readonly<Pick<Core, "costs">>;
    route: RangeRoute;
    chart?: keyof typeof COST_CHARTS;
  } = $props();

  const laid = $derived(COST_CHARTS[chart]());

  // Costs come by the day: a day is one band.
  const data = new RangeData(
    () => route,
    (from, to) => core.costs(from, to),
    "day",
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
