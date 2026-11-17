<!--
  A figure's range analytics (ADR 21): the sheet's range control, then the panel that reads it.
  Any other figure without a series in history shows `fallback` instead.
-->
<script lang="ts" module>
  import type { Core, PvString } from "../api/core.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";

  /** What the analytics read: the core, the sheet's range and the layout's strings. The weather
   * detail, which stands in their place, reads `history` (ADR 23); the PV forecast's days read
   * the `layout` (ADR 21); the savings read `costs` and `payback` (ADR 12); the inverter's facts
   * read which profiles map a temperature from `capabilities`. */
  export interface AnalyticsInput {
    readonly core: Readonly<
      Pick<
        Core,
        | "statistics"
        | "forecasts"
        | "capabilities"
        | "moduleTypes"
        | "corrections"
        | "history"
        | "layout"
        | "costs"
        | "payback"
      >
    >;
    readonly route: RangeRoute;
    readonly strings: readonly PvString[];
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { analyticsOf } from "../analytics/sources.ts";
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import type { HeadView } from "./head.svelte.ts";
  import RangePanel from "./RangePanel.svelte";
  import RangeState from "./RangeState.svelte";

  let {
    id,
    title,
    colour,
    input,
    head,
    onretry,
    priced,
    fallback,
  }: {
    id: string;
    title: string;
    /** The figure's energy token. */
    colour: string;
    input: AnalyticsInput;
    /** The figure over the range: what the range holds and whether it could be read. */
    head: HeadView | null;
    onretry: () => void;
    /** A tariff is in force (ADR 12). */
    priced: boolean;
    fallback: Snippet;
  } = $props();

  const analytics = $derived(analyticsOf(id, input.strings));
</script>

{#if analytics || id === "autarky"}
  <section
    class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6"
    aria-label={m.detail_analytics()}
  >
    <RangeControl model={input.route} />
    <RangeState {head} {onretry}>
      <RangePanel {id} {title} {colour} {analytics} {input} {priced} />
    </RangeState>
  </section>
{:else}
  {@render fallback()}
{/if}
