<!--
  The savings sheet's range (ADR 21 "Sheet content", ADR 12): its control, then what was saved
  over it and its parts.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import type { HeadView } from "./head.svelte.ts";
  import NoTariff from "./NoTariff.svelte";
  import RangeState from "./RangeState.svelte";
  import SavingsChart from "./SavingsChart.svelte";

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

<section
  class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6"
  aria-label={m.detail_analytics()}
>
  <RangeControl model={input.route} />
  {#if priced}
    <RangeState {head} {onretry}>
      <SavingsChart core={input.core} route={input.route} />
    </RangeState>
  {:else}
    <NoTariff {admin} />
  {/if}
</section>
