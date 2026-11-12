<!-- PROTOTYPE: detail as a glass side sheet (desktop, tablet) or a draggable bottom sheet (phone). Its hash route is the caller's. -->
<script lang="ts">
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import BottomSheet from "./BottomSheet.svelte";
  import DetailBody from "./DetailBody.svelte";
  import { input } from "./input.svelte";
  import type { LiveSim } from "./sim.svelte";
  import { DETAILS } from "./details";
  import type { Sel } from "./stats/query";

  let {
    id = null,
    sim,
    onclose,
    onopen,
    onhistory,
  }: { id?: string | null; sim: LiveSim; onclose: () => void; onopen: (id: string) => void; onhistory: (sel: Sel, id: string) => void } = $props();

  // The body keeps its last figure while the sheet slides out.
  let last = $state("production");
  $effect(() => {
    if (id) last = id;
  });
  const shown = $derived(id ?? last);
  const side = $derived(input.mouse || input.wide);
</script>

{#if side}
  <Sheet.Root open={id !== null} onOpenChange={(o) => !o && onclose()}>
    <Sheet.Content
      side="right"
      data-detail-sheet
      tabindex={-1}
      onOpenAutoFocus={(e) => {
        // Focus the sheet, not its first control: a mouse open should not paint a focus ring.
        e.preventDefault();
        (document.querySelector("[data-detail-sheet]") as HTMLElement | null)?.focus();
      }}
      class="glass-ambient w-full gap-0 overflow-y-auto p-0 outline-none no-scrollbar data-[side=right]:sm:max-w-[460px]"
    >
      <Sheet.Title class="sr-only">{DETAILS[shown]?.title}</Sheet.Title>
      <DetailBody id={shown} {sim} {onhistory} {onopen} />
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <BottomSheet bind:open={() => id !== null, (v) => { if (!v) onclose(); }} label={DETAILS[shown]?.title ?? "Detail"}>
    <div class="overflow-y-auto no-scrollbar" data-no-drag-scroll>
      <DetailBody id={shown} {sim} {onhistory} {onopen} />
    </div>
  </BottomSheet>
{/if}

<style>
  /* A detail sits beside the dashboard it was opened from: the scrim dims it but leaves it readable,
     and no full-screen backdrop blur fades in (ADR 21: never animate backdrop-filter). */
  :global(body:has([data-detail-sheet]) [data-slot="sheet-overlay"]) {
    background: color-mix(in oklab, var(--background) 55%, transparent);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
</style>
