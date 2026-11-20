<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeScreen from "../range/RangeScreen.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import ForecastChart from "./ForecastChart.svelte";
  import { AHEAD, inverterLines } from "./forecast.ts";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  // The range may step as far as the forecast reaches.
  const route = new RangeRoute(() => ({ params, go, core }), AHEAD);

  /** Bumped by a retry, so the lines are read again. */
  let attempt = $state(0);

  const inverters = $derived.by(() => {
    void attempt;

    return inverterLines(core);
  });
</script>

<RangeScreen title={m.forecast_title()} model={route}>
  {#await inverters}
    <!-- One inverter's card at its size: the title, the headline, then its chart and figures. -->
    <RangeCard>
      <Skeleton class="h-9 w-48" />
      <Skeleton class="h-12" />
      <Skeleton class="h-[480px]" role="status" aria-label={m.loading()} />
    </RangeCard>
  {:then shown}
    {#each shown as inverter (inverter.device)}
      <RangeCard>
        <ForecastChart {core} device={inverter.device} lines={inverter.lines} {route} />
      </RangeCard>
    {:else}
      <p>{m.forecast_none()}</p>
    {/each}
  {:catch}
    <RangeCard>
      <LoadFailed size="block" text={m.forecast_error()} onretry={() => (attempt += 1)} />
    </RangeCard>
  {/await}
</RangeScreen>
