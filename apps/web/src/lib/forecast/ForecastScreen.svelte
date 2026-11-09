<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import ForecastChart from "./ForecastChart.svelte";
  import { inverterLines } from "./forecast.ts";

  let { core }: { core: Core } = $props();

  const inverters = $derived(inverterLines(core));
</script>

<main>
  <h1>{m.forecast_title()}</h1>
  {#await inverters then shown}
    {#each shown as inverter (inverter.device)}
      <section>
        <h2>{m.forecast_inverter({ device: inverter.device })}</h2>
        <ForecastChart {core} device={inverter.device} lines={inverter.lines} />
      </section>
    {:else}
      <p>{m.forecast_none()}</p>
    {/each}
  {/await}
</main>
