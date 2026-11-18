<!--
  A sheet's range (ADR 21): its range control, then what reads the range.
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
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";

  let { route, children }: { route: RangeRoute; children: Snippet } = $props();
</script>

<section
  class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6"
  aria-label={m.detail_analytics()}
>
  <RangeControl model={route} />
  {@render children()}
</section>
