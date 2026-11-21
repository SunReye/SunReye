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

  /** An inverter's card body at a phone's width, in px: the placeholder's, loading or empty. */
  const CARD_HEIGHT = 685;

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
      <div class="flex flex-col gap-4" style:height="{CARD_HEIGHT}px">
        <Skeleton class="h-9 w-48" />
        <Skeleton class="h-12" />
        <Skeleton class="min-h-0 flex-1" role="status" aria-label={m.loading()} />
      </div>
    </RangeCard>
  {:then shown}
    {#each shown as inverter (inverter.device)}
      <RangeCard>
        <ForecastChart {core} device={inverter.device} lines={inverter.lines} {route} />
      </RangeCard>
    {:else}
      <RangeCard>
        <p
          class="flex items-center justify-center text-sm text-muted-foreground"
          style:height="{CARD_HEIGHT}px"
        >
          {m.forecast_none()}
        </p>
      </RangeCard>
    {/each}
  {:catch}
    <RangeCard>
      <LoadFailed size="block" text={m.forecast_error()} onretry={() => (attempt += 1)} />
    </RangeCard>
  {/await}
</RangeScreen>
