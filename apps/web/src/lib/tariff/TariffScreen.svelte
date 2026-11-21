<!--
  Tariff (ADR 11, 12): the prices now and the range's costs. The tariff is set up in
  Settings › Tariff; money over time and payback live in History, which this screen links to.
-->
<script lang="ts">
  import Section from "../components/section.svelte";
  import TextLink from "../components/text-link.svelte";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import RangeCard from "../range/RangeCard.svelte";
  import RangeScreen from "../range/RangeScreen.svelte";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import Costs from "./Costs.svelte";
  import PricesNow from "./PricesNow.svelte";

  let { core, params, go }: { core: Core; params: URLSearchParams; go: Go } = $props();

  const route = new RangeRoute(() => ({ params, go, core }));
</script>

<RangeScreen title={m.tariff_title()} model={route}>
  <PricesNow />
  <RangeCard>
    <Section title={m.tariff_costs()}>
      <Costs {core} {route} />
    </Section>
  </RangeCard>
  <TextLink href="#/history?metric=money" onward class="self-start text-sm">
    {m.stats_open_history()}
  </TextLink>
</RangeScreen>
