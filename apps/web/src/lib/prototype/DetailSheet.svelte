<!-- PROTOTYPE: detail as a glass side sheet (desktop, tablet) or a draggable bottom sheet (phone). -->
<script lang="ts">
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import BottomSheet from "./BottomSheet.svelte";
  import DetailBody from "./DetailBody.svelte";
  import { input } from "./input.svelte";
  import type { LiveSim } from "./sim.svelte";
  import { DETAILS } from "./details";

  let { id = $bindable(null), sim, onhistory }: { id?: string | null; sim: LiveSim; onhistory: () => void } = $props();
  let last = $state("production");
  $effect(() => {
    if (id) last = id;
  });
  const side = $derived(input.mouse || input.wide);
</script>

{#if side}
  <Sheet.Root open={id !== null} onOpenChange={(o) => !o && (id = null)}>
    <Sheet.Content side="right" class="glass-ambient w-full gap-0 overflow-y-auto p-6 no-scrollbar sm:max-w-[460px]">
      <Sheet.Title class="sr-only">{DETAILS[last]?.title}</Sheet.Title>
      <DetailBody id={last} {sim} {onhistory} />
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <BottomSheet bind:open={() => id !== null, (v) => { if (!v) id = null; }} label={DETAILS[last]?.title ?? "Detail"}>
    <div class="overflow-y-auto px-5 pt-2 pb-4 no-scrollbar" data-no-drag-scroll>
      <DetailBody id={last} {sim} {onhistory} />
    </div>
  </BottomSheet>
{/if}
