<!-- At most three things worth a look, each leading to its cause. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Info from "@lucide/svelte/icons/info";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { Note } from "./notes.ts";

  let { notes, onnote }: { notes: readonly Note[]; onnote: (note: Note) => void } = $props();
</script>

<section class="glass-ambient rounded-lg ring-1 ring-foreground/10" aria-label={m.stats_notes()}>
  <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">{m.stats_notes()}</h2>
  <ul class="divide-y divide-border/60 border-t border-border/60">
    {#each notes as n (n.text)}
      <li>
        <button
          type="button"
          class="row flex w-full items-start gap-2.5 px-4 py-2.5 text-left"
          onclick={() => {
            haptics.soft();
            onnote(n);
          }}
        >
          {#if n.tone === "warn"}<TriangleAlert
              class="mt-0.5 size-4 shrink-0 text-warning"
            />{:else}<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" />{/if}
          <span class="min-w-0 flex-1 text-sm text-pretty"
            >{n.text}<span class="mt-0.5 block text-xs font-medium text-brand">{n.action}</span
            ></span
          >
          <ChevronRight class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .row {
    outline: none;
    transition: background-color 120ms var(--motion-ease);
  }
  .row:hover {
    background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
  }
  .row:active {
    background-color: color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
  :global([data-motion="still"]) .row {
    transition: none;
  }
</style>
