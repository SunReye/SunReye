<!--
  Savings and costs over the route's range, a band per day, week or month, from the core's
  plant-local days (ADR 12): savings above the baseline, the import bill below it.
-->
<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import { flowColour } from "../energy-colours.ts";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { money } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { costBands, split } from "./costs.ts";

  let { core, route }: { core: Core; route: RangeRoute } = $props();

  // Costs come by the day: a day is one band.
  const data = new RangeData(
    () => route,
    (from, to) => core.costs(from, to),
    "day",
  );

  const view = $derived.by(() => {
    const got = data.current;

    if (!got) return null;

    if ("problem" in got.data) return { problem: got.data.problem, bands: [], total: split() };

    return {
      problem: null,
      bands: bandsOf(got.list, costBands(got.data.days, got.spans, got.now)),
      total: split(got.data.total),
    };
  });
</script>

{#if view?.problem}
  <ProblemAlert problem={view.problem} />
{:else}
  <BandChart
    bands={view?.bands ?? []}
    up={[
      { label: m.tariff_avoided(), colour: flowColour("solar") },
      { label: m.tariff_feed_in_pay(), colour: flowColour("export") },
    ]}
    down={[
      { label: m.tariff_import_cost(), colour: flowColour("import") },
      { label: m.tariff_standing(), colour: flowColour("house") },
    ]}
    groups={[m.tariff_saving_group(), m.tariff_cost_group()]}
    via={data.current?.via}
    summary={{ title: data.title, ...(view?.total ?? split()) }}
    fmt={money}
    unit="€"
    loading={!view}
    label={m.tariff_chart()}
    ondrill={data.drill}
    onbrush={data.brush}
  />
{/if}
