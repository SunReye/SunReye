<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import HistoryChart from "./HistoryChart.svelte";
  import { choices, type Choice } from "./history.ts";
  import SeriesPicker from "./SeriesPicker.svelte";
  import StatisticsTable from "./StatisticsTable.svelte";

  let { core }: { core: Core } = $props();

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

<main>
  <h1>{m.history_title()}</h1>
  <SeriesPicker {devices} bind:device bind:series />
  {#if device !== undefined && series !== undefined}
    <HistoryChart {core} {device} {series} />
    <StatisticsTable {core} {device} {series} />
  {/if}
</main>
