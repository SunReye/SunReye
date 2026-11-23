<!--
  Where the picker stands (ADR 22): a pane left of the chart from 1024 px, whatever the input;
  below that a drawer under the bar, or a dialog beside the rail, open while the route says so.
-->
<script lang="ts">
  import * as Card from "@sunreye/ui/card";
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
  <Card.Root
    element="aside"
    aria-label={m.explore_picker()}
    class="sticky top-6 max-h-[calc(100dvh-3rem)] min-h-[416px] gap-0 self-start py-0"
  >
    <Picker {x} onpick={x.toggle} bind:search />
  </Card.Root>
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
