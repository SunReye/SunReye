<!--
  The tracing mode's bar on the canvas (ADR 20): what to do, the roof's eave and ridge heights to
  pull it up by, the picked line's kind and its points' heights, removing it, and leaving. A bent
  face is said here. Under the time slider, a canvas chip; Delete or Backspace removes the picked
  line too.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button } from "@sunreye/ui/button";
  import PickedLine from "./PickedLine.svelte";
  import RoofHeights from "./RoofHeights.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Session } from "./session.svelte.ts";

  let { session }: { session: Session | undefined } = $props();

  const mode = $derived(session?.tracing);

  const picked = $derived(mode?.picked);
</script>

<svelte:window
  onkeydown={(event) => {
    const typing =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;

    if (!typing && (event.key === "Delete" || event.key === "Backspace") && mode?.line) {
      event.preventDefault();
      mode.remove();
    }
  }}
/>

{#if mode?.active}
  <!-- Under the time slider, clear of the views' buttons on the right. -->
  <div class="pointer-events-none absolute top-16 right-16 left-3 flex justify-center">
    <div data-canvas-zone class="max-w-full">
      <div
        role="toolbar"
        aria-label={m.builder_trace()}
        class="canvas-chip pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3 ring-1 ring-border/60 elevation-1"
      >
        {#if picked}
          <PickedLine {mode} {picked} />
        {:else}
          <RoofHeights {mode} />
        {/if}
        <span class="flex-1"></span>
        <Button
          size="sm"
          onclick={() => {
            mode.leave();
          }}
        >
          <Check data-icon="inline-start" />
          {m.builder_trace_done()}
        </Button>
        {#if mode.bent}
          <p role="status" class="basis-full text-sm text-pretty text-warning">
            {m.builder_trace_bent()}
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
