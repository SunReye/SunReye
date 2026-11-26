<!--
  What reads a sheet's range (ADR 21 "Sheet content"), by its panel, under the range control: a
  failed or empty range stands in its place. The savings, which have no tabs, frame their own.
-->
<script lang="ts">
  import Analytics, { type AnalyticsInput } from "./Analytics.svelte";
  import AutarkyPanel from "./AutarkyPanel.svelte";
  import BatteryPanel from "./BatteryPanel.svelte";
  import type { HeadView } from "./head.svelte.ts";
  import RangeState from "./RangeState.svelte";
  import SavingsPane from "./SavingsPane.svelte";
  import type { Analytics as Charted, Panel } from "./sheets.ts";
  import TabbedPanel from "./TabbedPanel.svelte";

  let {
    panel,
    analytics,
    title,
    colour,
    input,
    head,
    onretry,
    priced,
    admin,
  }: {
    panel: Panel;
    analytics: Charted | null;
    title: string;
    /** The figure's energy token. */
    colour: string;
    input: AnalyticsInput;
    /** The figure over the range: what the range holds and whether it could be read. */
    head: HeadView | null;
    onretry: () => void;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
    admin: boolean;
  } = $props();
</script>

{#if panel.kind === "savings"}
  <SavingsPane {input} {head} {onretry} {priced} {admin} />
{:else}
  <Analytics route={input.route}>
    <RangeState {head} {onretry}>
      {#if panel.kind === "autarky"}
        <AutarkyPanel {input} />
      {:else if analytics && panel.kind === "battery"}
        <BatteryPanel {title} {colour} {analytics} {input} />
      {:else if analytics}
        <TabbedPanel {panel} {title} {colour} {analytics} {input} {priced} />
      {/if}
    </RangeState>
  </Analytics>
{/if}
