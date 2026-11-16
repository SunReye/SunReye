<!--
  Where the picker stands (ADR 22): a pane left of the chart from 1024 px, whatever the input;
  below that a drawer under the bar, or a dialog beside the rail, open while the route says so.
-->
<script lang="ts">
  import GlassCard from "../components/glass-card.svelte";
  import ResponsiveSheet from "../components/responsive-sheet.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Explore } from "./explore.svelte.ts";
  import Picker from "./Picker.svelte";

  let {
    x,
    paned,
    search = $bindable(null),
  }: {
    x: Explore;
    paned: boolean;
    /** The pane's search field. */
    search?: HTMLInputElement | null;
  } = $props();
</script>

{#if paned}
  <GlassCard
    element="aside"
    aria-label={m.explore_picker()}
    class="sticky top-6 flex max-h-[calc(100dvh-3rem)] min-h-[416px] flex-col self-start"
  >
    <Picker {x} onpick={x.toggle} bind:search />
  </GlassCard>
{:else}
  <ResponsiveSheet
    label={m.explore_picker()}
    titled
    class="flex max-h-[85dvh] flex-col"
    bind:open={
      () => x.view.picking,
      (open) => {
        if (!open) x.closePicker();
      }
    }
  >
    <Picker {x} onpick={x.choose} />
  </ResponsiveSheet>
{/if}
