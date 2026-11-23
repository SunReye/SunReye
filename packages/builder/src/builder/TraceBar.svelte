<!--
  The tracing mode's bar on the canvas (ADR 20): what to do, removing the picked line, and leaving.
  Under the time slider, a canvas chip; Delete or Backspace removes the picked line too.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import type { Session } from "./session.svelte.ts";

  let { session }: { session: Session | undefined } = $props();

  const mode = $derived(session?.tracing);
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
        class="canvas-chip pointer-events-auto flex max-w-lg items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3 ring-1 ring-border/60 elevation-1"
      >
        <p class="min-w-0 flex-1 text-sm text-pretty text-muted-foreground">
          {m.builder_trace_hint()}
        </p>
        {#if mode.line}
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              mode.remove();
            }}
          >
            <Trash data-icon="inline-start" />
            {m.builder_trace_remove()}
          </Button>
        {/if}
        <Button
          size="sm"
          onclick={() => {
            mode.leave();
          }}
        >
          <Check data-icon="inline-start" />
          {m.builder_trace_done()}
        </Button>
      </div>
    </div>
  </div>
{/if}
