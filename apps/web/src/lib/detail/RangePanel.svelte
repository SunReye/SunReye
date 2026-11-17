<!--
  What a sheet's range control reads into (ADR 21 "Sheet content"): the battery its own panel; a
  measured figure its tabs, then its flow's or its PV's facts; autarky, which no one series holds,
  a panel of its own.
-->
<script lang="ts">
  import type { Analytics } from "../analytics/sources.ts";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsTabs from "./AnalyticsTabs.svelte";
  import AutarkyPanel from "./AutarkyPanel.svelte";
  import BatteryPanel from "./BatteryPanel.svelte";
  import { flowOf } from "./flow.ts";
  import FlowPanel from "./FlowPanel.svelte";
  import PvFacts from "./PvFacts.svelte";
  import { isPv } from "./pv-range.ts";

  let {
    id,
    title,
    colour,
    analytics,
    input,
    priced,
  }: {
    id: string;
    title: string;
    /** The figure's energy token. */
    colour: string;
    /** Null for autarky. */
    analytics: Analytics | null;
    input: AnalyticsInput;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
  } = $props();

  const flow = $derived(flowOf(id));
</script>

{#if analytics === null}
  <AutarkyPanel {input} />
{:else if id === "battery"}
  <BatteryPanel {id} {title} {colour} {analytics} {input} />
{:else}
  <AnalyticsTabs {id} {title} {colour} {analytics} {input} />
  {#if flow}
    <FlowPanel {input} {flow} {priced} />
  {:else if isPv(id)}
    <PvFacts {analytics} inverter={id === "inverter"} {input} />
  {/if}
{/if}
