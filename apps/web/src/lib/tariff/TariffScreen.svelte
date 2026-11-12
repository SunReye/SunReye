<script lang="ts">
  import type { Core } from "../api/core";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeControl from "../range/RangeControl.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import Costs from "./Costs.svelte";
  import Payback from "./Payback.svelte";
  import PricesNow from "./PricesNow.svelte";
  import SpotZone from "./SpotZone.svelte";
  import TariffPanel from "./TariffPanel.svelte";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  const route = new RangeRoute(() => ({ params, go, core }));
</script>

<main
  class="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6"
>
  <PricesNow {core} />
  <RangeCard model={route}>
    <RangeControl model={route} />
    <Costs {core} {route} />
  </RangeCard>
  <Payback {core} />
  <TariffPanel {core} />
  <SpotZone {core} />
</main>
