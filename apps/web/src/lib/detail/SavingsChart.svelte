<!--
  The savings sheet's chart (ADR 21, 12): what was saved per day, week or month of the range, from
  the core's plant-local days, avoided import and feed-in pay stacked; below the baseline the import
  the plant could not avoid. Its legend states the parts.
-->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { flowColour } from "../energy-colours.ts";
  import { m } from "../paraglide/messages.js";
  import BandChart from "../range/BandChart.svelte";
  import { bandsOf } from "../range/fill.ts";
  import { money } from "../range/format.ts";
  import { RangeData } from "../range/range-data.svelte.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { costBands, savingsSplit } from "../tariff/costs.ts";

  let { core, route }: { core: Readonly<Pick<Core, "costs">>; route: RangeRoute } = $props();

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
      return { problem: got.data.problem, bands: [], total: savingsSplit() };

    return {
      problem: null,
      bands: bandsOf(got.list, costBands(got.data.days, got.spans, got.now, savingsSplit)),
      total: savingsSplit(got.data.total),
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
    down={[{ label: m.detail_unavoided(), colour: flowColour("import") }]}
    groups={[m.tariff_saving_group(), m.detail_paid()]}
    via={data.current?.via}
    summary={{ title: data.title, ...(view?.total ?? savingsSplit()) }}
    fmt={money}
    unit="€"
    loading={!view}
    label={m.detail_savings_chart()}
    ondrill={data.drill}
    onbrush={data.brush}
  />
{/if}
