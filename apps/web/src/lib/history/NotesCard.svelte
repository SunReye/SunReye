<!-- At most three things worth a look, each leading to its cause. -->
<script lang="ts">
  import GlassCard from "../components/glass-card.svelte";
  import OpenRow from "../components/open-row.svelte";
  import Info from "@lucide/svelte/icons/info";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { m } from "../paraglide/messages.js";
  import type { Note } from "./notes.ts";

  let { notes, onnote }: { notes: readonly Note[]; onnote: (note: Note) => void } = $props();
</script>

<GlassCard element="section" aria-label={m.stats_notes()}>
  <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">{m.stats_notes()}</h2>
  <ul class="divide-y divide-border/60 border-t border-border/60">
    {#each notes as n (n.text)}
      <li>
        <OpenRow
          class="items-start gap-2.5 px-4 py-2.5"
          chevron="mt-0.5"
          onopen={() => {
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
        </OpenRow>
      </li>
    {/each}
  </ul>
</GlassCard>
