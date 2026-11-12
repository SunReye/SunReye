<!--
  Tariff (ADR 11, 12): the prices now and the range's costs. The tariff is set up in
  Settings › Tariff; money over time and payback live in History, which this screen links to.
-->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeControl from "../range/RangeControl.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import Costs from "./Costs.svelte";
  import PricesNow from "./PricesNow.svelte";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  const route = new RangeRoute(() => ({ params, go, core }));
</script>

<main
  class="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6"
>
  <h1 class="text-xl font-semibold tracking-tight lg:leading-8">{m.tariff_title()}</h1>
  <PricesNow {core} />
  <RangeCard model={route}>
    <RangeControl model={route} />
    <Costs {core} {route} />
  </RangeCard>
  <a
    href="#/history?metric=money"
    class="group flex items-center gap-2 self-start text-sm font-medium text-brand outline-none hover:underline focus-visible:underline"
  >
    {m.stats_open_history()}
    <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
  </a>
</main>
