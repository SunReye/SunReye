<!-- A second figure over the range beside the head's, smaller and named alone: only the head states
  the range and its change (ADR 21 "Sheet content"). -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { HeadView } from "./head.svelte.ts";
  import Quantity from "./Quantity.svelte";

  let { view }: { view: HeadView } = $props();
</script>

<p class="flex flex-col items-end text-right">
  {#if view.state === "loading"}
    <Skeleton class="h-5 w-20" role="status" aria-label={m.loading()} />
  {:else}
    <span class="text-xl leading-none font-semibold tracking-tight">
      <Quantity
        value={view.value}
        unit={view.unit}
        digits={view.digits}
        unitClass="text-sm font-medium text-muted-foreground"
      />
    </span>
  {/if}
  <span class="mt-1 text-xs text-muted-foreground">{view.name}</span>
</p>
