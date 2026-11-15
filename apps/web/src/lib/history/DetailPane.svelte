<!-- The tabs beside the charts: the tariff, payback, the strings, the battery and the record. -->
<script lang="ts">
  import StringsPanel from "../analytics/StringsPanel.svelte";
  import BatteryPanel from "./BatteryPanel.svelte";
  import DataPanel from "./DataPanel.svelte";
  import { gapsOf } from "./flows.ts";
  import type { PaneProps } from "./pane.ts";
  import PaybackPanel from "./PaybackPanel.svelte";
  import TariffTab from "./TariffTab.svelte";

  let { core, got, view, route, facts, loading, height }: PaneProps = $props();

  const span = $derived([got.spans[0]?.[0] ?? 0, got.spans.at(-1)?.[1] ?? 0] as const);
  const elapsed = $derived(Math.max(0, Math.min(span[1], got.now) - span[0]));
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
    gaps={gapsOf(got.plant, span[0], span[1], got.now)}
    covered={got.sum.covered}
    {elapsed}
    label={route.label}
    {since}
    zone={got.zone}
    onopen={route.open}
  />
{/if}
