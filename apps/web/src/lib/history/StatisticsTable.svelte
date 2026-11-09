<script lang="ts">
  import type { Core, Period } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { periodFigures } from "./history.ts";
  import StatisticsRows from "./StatisticsRows.svelte";

  let { core, device, series }: { core: Core; device: number; series: string } = $props();

  let period = $state<Period>("day");

  const periods: readonly (readonly [Period, string])[] = [
    ["day", m.history_day()],
    ["week", m.history_week()],
    ["month", m.history_month()],
  ];

  const loaded = $derived(periodFigures(core, device, series, period));
</script>

<section>
  <h2>{m.history_statistics()}</h2>
  <label>
    {m.history_period()}
    <select bind:value={period}>
      {#each periods as [key, text] (key)}
        <option value={key}>{text}</option>
      {/each}
    </select>
  </label>
  {#await loaded then points}
    <StatisticsRows {points} {series} {period} />
  {/await}
</section>
