<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeScreen from "../range/RangeScreen.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import HistoryChart from "./HistoryChart.svelte";
  import { choices, type Choice } from "./history.ts";
  import SeriesPicker from "./SeriesPicker.svelte";
  import StatisticsTable from "./StatisticsTable.svelte";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  const route = new RangeRoute(() => ({ params, go, core }));

  /** The devices of the first live snapshot: history needs no live updates. */
  let devices = $state.raw<readonly Choice[]>([]);

  $effect(() => {
    const stop = core.live((live) => {
      if ("devices" in live) {
        devices = choices(live.devices);
        stop();
      }
    });

    return stop;
  });

  let device = $derived(devices[0]?.device);
  let series = $derived(devices.find((d) => d.device === device)?.series[0]);
</script>

<RangeScreen title={m.history_title()} model={route}>
  <SeriesPicker {devices} bind:device bind:series />
  {#if device !== undefined && series !== undefined}
    <RangeCard model={route}>
      <HistoryChart {core} {device} {series} {route} />
    </RangeCard>
    <StatisticsTable {core} {device} {series} />
  {/if}
</RangeScreen>
