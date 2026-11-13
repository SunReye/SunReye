<!-- One reading: its label, its age once stale, its value; a reading that is a node opens it. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ReadingValue from "./ReadingValue.svelte";
  import { ago } from "./readings.ts";
  import type { Row } from "./rows.ts";

  let {
    row,
    loading,
    silent,
    onopen,
  }: { row: Row; loading: boolean; silent: boolean; onopen: (id: string) => void } = $props();

  const dim = $derived(silent || row.age !== undefined);
  const to = $derived(row.to);
</script>

{#snippet label()}
  <!-- Two lines before an ellipsis: a long name differs from its neighbour's at its end. -->
  <span class="line-clamp-2 min-w-0 break-words text-muted-foreground">{row.label}</span>
  {#if row.age !== undefined && !silent}
    <span class="shrink-0 text-xs text-warning">{ago(row.age)}</span>
  {/if}
{/snippet}

{#if to === undefined}
  <div class="flex items-baseline gap-2 py-2">
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label()}</dt>
    <dd><ReadingValue {row} {loading} {dim} /></dd>
  </div>
{:else}
  <Pressable
    class="group -mx-2 flex items-baseline gap-2 rounded-sm px-2 py-2 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
    onclick={() => onopen(to)}
  >
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label()}</dt>
    <dd class="flex items-baseline gap-1">
      <ReadingValue {row} {loading} {dim} /><ChevronRight
        class="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </dd>
  </Pressable>
{/if}
