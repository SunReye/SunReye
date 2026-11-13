<!-- A list still loading (ADR 21): skeleton rows of a settings row's size, so nothing shifts. -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";

  let { rows = 2 }: { rows?: number } = $props();

  const lines = $derived(Array.from({ length: rows }, (_, i) => i));
</script>

<div role="status" aria-label={m.loading()} aria-busy="true" class="divide-y divide-border/60">
  {#each lines as line (line)}
    <div class="flex flex-col gap-2 px-4 py-3.5">
      <Skeleton class="h-4 w-2/5" />
      <Skeleton class="h-3 w-3/5" />
    </div>
  {/each}
</div>
