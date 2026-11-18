<!--
  A figure's detail (ADR 21). It leads with the figure it was opened from; a node's readings follow
  where the live graph ends, then the range, its tabs and the facts. No cards inside the sheet: the
  sheet is the one surface, divided by hairlines. It ends with the one way onward.
-->
<script lang="ts" module>
  import type { Day } from "../dashboard/day.ts";
  import type { Stored } from "../live/plant-facts.ts";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import type { Figure } from "./figures.ts";
  import type { NodeReadings } from "./readings.ts";
</script>

<script lang="ts">
  import DetailHead from "./DetailHead.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { RangeHead } from "./head.svelte.ts";
  import HistoryLink from "./HistoryLink.svelte";
  import LiveSection from "./LiveSection.svelte";
  import RangePanel from "./RangePanel.svelte";
  import Readings from "./Readings.svelte";
  import { sheetOf } from "./sheet-of.ts";
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

  const sheet = $derived(sheetOf(id, input.strings));
  const shown = $derived(sheet?.facts?.(day, spot?.["price.spot"]) ?? { lead: null, stats: [] });
  const power = $derived(spec.node !== null);
  const silent = $derived(node?.silent ?? null);

  const head = new RangeHead(() => ({
    head: sheet?.head ?? null,
    core: input.core,
    route: input.route,
    record,
  }));
</script>

<div class="flex min-h-full flex-col">
  <DetailHead {title} {spec} {node} {status} head={head.view} lead={shown.lead} />

  {#if power}
    <LiveSection {spec} points={node?.points ?? []} {silent} {status} />
  {/if}

  <Readings {node} {status} {onopen} />

  {#if sheet?.panel}
    <RangePanel
      panel={sheet.panel}
      analytics={sheet.analytics}
      {title}
      colour={spec.colour}
      {input}
      head={head.view}
      onretry={head.retry}
      {priced}
      {admin}
    />
  {:else}
    <TodayChart chart={spec.chart} {day} core={input.core} />
  {/if}

  {#if shown.stats.length > 0}
    <DetailStats stats={shown.stats} />
  {/if}

  <!-- The PV forecast's days end on the Forecast screen, their own way onward (ADR 21). -->
  {#if sheet && spec.chart !== "forecast"}
    <HistoryLink route={input.route} onward={sheet.history} />
  {/if}
</div>
