<!--
  Tariff (ADR 11, 12): the prices now and the range's costs. The tariff is set up in
  Settings › Tariff; money over time and payback live in History, which this screen links to.
-->
<script lang="ts">
  import Section from "../components/section.svelte";
  import PageTitle from "../components/page-title.svelte";
  import TextLink from "../components/text-link.svelte";
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
  <PageTitle wide title={m.tariff_title()} />
  <PricesNow />
  <RangeCard>
    <RangeControl model={route} />
    <Section title={m.tariff_costs()}>
      <Costs {core} {route} />
    </Section>
  </RangeCard>
  <TextLink href="#/history?metric=money" onward class="self-start text-sm">
    {m.stats_open_history()}
  </TextLink>
</main>
