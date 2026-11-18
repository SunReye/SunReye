<!--
  A measured sheet's tabs, then what its panel states of the range below them: a flow's facts, the
  PV facts or the charging sessions (ADR 21 "Sheet content").
-->
<script lang="ts">
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsTabs from "./AnalyticsTabs.svelte";
  import EvPanel from "./EvPanel.svelte";
  import FlowPanel from "./FlowPanel.svelte";
  import PvFacts from "./PvFacts.svelte";
  import type { Analytics, Panel } from "./sheets.ts";

  let {
    panel,
    title,
    colour,
    analytics,
    input,
    priced,
  }: {
    panel: Panel;
    title: string;
    /** The figure's energy token. */
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
  } = $props();
</script>

<AnalyticsTabs {title} {colour} {analytics} {input} />
{#if panel.kind === "ev"}
  <EvPanel {input} device={analytics.device} />
{:else if panel.kind === "flow"}
  <FlowPanel {input} flow={panel.flow} {priced} />
{:else if panel.kind === "pv"}
  <PvFacts {analytics} inverter={panel.inverter} {input} />
{/if}
