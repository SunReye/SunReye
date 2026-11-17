<!--
  A figure's detail (ADR 21). It leads with the figure it was opened from; a node's readings follow
  where the live graph ends, then the range, its tabs and the facts. No cards inside the sheet: the
  sheet is the one surface, divided by hairlines. It ends with the one way onward.
-->
<script lang="ts" module>
  import type { Day } from "../dashboard/day.ts";
  import type { Stored } from "../live/plant-facts.ts";
  import type { NodeReadings } from "./readings.ts";
</script>

<script lang="ts">
  import Analytics, { type AnalyticsInput } from "./Analytics.svelte";
  import DetailHead from "./DetailHead.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { facts, type Figure } from "./figures.ts";
  import { RangeHead } from "./head.svelte.ts";
  import HistoryLink from "./HistoryLink.svelte";
  import LiveSection from "./LiveSection.svelte";
  import Readings from "./Readings.svelte";
  import SavingsPane from "./SavingsPane.svelte";
  import TodayChart from "./TodayChart.svelte";

  let {
    id,
    title,
    spec,
    node,
    status,
    day,
    spot,
    input,
    record,
    priced,
    admin,
    onopen,
  }: {
    id: string;
    title: string;
    spec: Figure;
    node: NodeReadings | null;
    status: "loading" | "live" | "stopped";
    day: Day | undefined;
    /** The spot-price device's live values. */
    spot: Readonly<Record<string, number>> | undefined;
    /** What the range analytics read; every tab reads the sheet's range. */
    input: AnalyticsInput;
    /** The stored series by `device/series` (ADR 22); null until the catalog is read. */
    record: ReadonlyMap<string, Stored> | null;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
    admin: boolean;
    onopen: (id: string) => void;
  } = $props();

  const shown = $derived(facts(id, day, spot?.["price.spot"]));
  const power = $derived(spec.node !== null);
  const silent = $derived(node?.silent ?? null);

  const head = new RangeHead(() => ({ id, ...input, record }));
</script>

<div class="flex min-h-full flex-col">
  <DetailHead {title} {spec} {node} {status} head={head.view} lead={shown.lead} />

  {#if power}
    <LiveSection {spec} points={node?.points ?? []} {silent} {status} />
  {/if}

  <Readings {node} {status} {onopen} />

  <Analytics {id} {title} colour={spec.colour} {input} head={head.view} onretry={head.retry}>
    {#snippet fallback()}
      {#if id === "saved"}
        <SavingsPane {input} head={head.view} onretry={head.retry} {priced} {admin} />
      {:else}
        <TodayChart chart={spec.chart} {day} core={input.core} />
      {/if}
    {/snippet}
  </Analytics>

  {#if shown.stats.length > 0}
    <DetailStats stats={shown.stats} />
  {/if}

  <!-- The PV forecast's days end on the Forecast screen, their own way onward (ADR 21). -->
  {#if spec.chart !== "forecast"}
    <HistoryLink route={input.route} {id} />
  {/if}
</div>
