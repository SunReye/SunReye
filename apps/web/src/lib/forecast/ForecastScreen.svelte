<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeScreen from "../range/RangeScreen.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import ForecastChart from "./ForecastChart.svelte";
  import { AHEAD, inverterLines } from "./forecast.ts";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  // The range may step as far as the forecast reaches.
  const route = new RangeRoute(() => ({ params, go, core }), AHEAD);

  const inverters = $derived(inverterLines(core));
</script>

<RangeScreen title={m.forecast_title()} model={route}>
  {#await inverters then shown}
    {#each shown as inverter (inverter.device)}
      <RangeCard model={route}>
        <h2 class="text-base font-semibold">{m.forecast_inverter({ device: inverter.device })}</h2>
        <ForecastChart {core} device={inverter.device} lines={inverter.lines} {route} />
      </RangeCard>
    {:else}
      <p>{m.forecast_none()}</p>
    {/each}
  {/await}
</RangeScreen>
