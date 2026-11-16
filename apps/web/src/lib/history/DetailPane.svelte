<!-- The tabs beside the charts: the tariff, payback, the strings, the battery and the record. -->
<script lang="ts">
  import StringsPanel from "../analytics/StringsPanel.svelte";
  import BatteryPanel from "./BatteryPanel.svelte";
  import DataPanel from "./DataPanel.svelte";
  import { begunOf } from "./facts.ts";
  import { gapsOf } from "./flows.ts";
  import type { PaneProps } from "./pane.ts";
  import PaybackPanel from "./PaybackPanel.svelte";
  import { recordedSpan } from "./summary.ts";
  import TariffTab from "./TariffTab.svelte";

  let { core, got, view, route, facts, loading, height }: PaneProps = $props();

  const span = $derived(recordedSpan(got, begunOf(facts)));
  const payback = $derived(facts?.payback ?? null);
  const strings = $derived(facts?.strings ?? []);
  const since = $derived(facts?.since ?? null);
</script>

{#if view.tab === "tariff"}
  <TariffTab {core} zone={got.zone} />
{:else if view.tab === "payback"}
  <PaybackPanel {payback} {loading} height={height - 60} />
{:else if view.tab === "strings"}
  <StringsPanel {core} {route} {strings} sid={view.sid} />
{:else if view.tab === "battery"}
  <BatteryPanel
    {core}
    sum={got.sum}
    end={got.range.to}
    zone={got.zone}
    {loading}
    height={height - 60}
  />
{:else}
  <DataPanel
    gaps={gapsOf(got.plant, span.from, span.to, got.now)}
    covered={got.sum.covered}
    elapsed={span.elapsed}
    label={route.label}
    {since}
    zone={got.zone}
    onopen={route.open}
  />
{/if}
