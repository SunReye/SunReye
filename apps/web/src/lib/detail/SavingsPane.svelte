<!--
  The savings sheet's range (ADR 21 "Sheet content", ADR 12): its control, then what was saved
  over it and its parts, the way to the tariff, and for the admin the savings since installation
  against the investment.
-->
<script lang="ts">
  import Costs from "../tariff/Costs.svelte";
  import Analytics, { type AnalyticsInput } from "./Analytics.svelte";
  import type { HeadView } from "./head.svelte.ts";
  import NoTariff from "./NoTariff.svelte";
  import RangeState from "./RangeState.svelte";
  import SavingsPayback from "./SavingsPayback.svelte";
  import TariffLink from "./TariffLink.svelte";

  let {
    input,
    head,
    onretry,
    priced,
    admin,
  }: {
    input: AnalyticsInput;
    /** The euros saved over the range: what the range holds and whether it could be read. */
    head: HeadView | null;
    onretry: () => void;
    /** A tariff is in force: without one nothing is saved (ADR 12). */
    priced: boolean;
    /** Only the admin sets a tariff. */
    admin: boolean;
  } = $props();
</script>

<Analytics route={input.route}>
  {#if priced}
    <RangeState {head} {onretry}>
      <Costs core={input.core} route={input.route} chart="savings" />
    </RangeState>
    <TariffLink route={input.route} />
  {:else}
    <NoTariff {admin} />
  {/if}
</Analytics>

{#if priced && admin}
  <SavingsPayback core={input.core} />
{/if}
