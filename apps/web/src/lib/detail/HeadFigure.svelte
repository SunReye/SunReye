<!-- A measured sheet's primary figure: its value over the range, the range's name and the change against the range before. -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { HeadView } from "./head.svelte.ts";
  import Quantity from "./Quantity.svelte";

  let { view }: { view: HeadView } = $props();
</script>

<p class="flex flex-col">
  {#if view.state === "loading"}
    <Skeleton class="h-9 w-32" role="status" aria-label={m.loading()} />
  {:else}
    <span class="text-4xl leading-none font-semibold tracking-tight"
      ><Quantity
        value={view.value}
        unit={view.unit}
        digits={view.digits}
        unitClass="text-lg font-medium text-muted-foreground"
      /></span
    >
  {/if}
  <span class="mt-1 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
    <span>{view.label}</span>
    {#if view.versus}
      <span aria-hidden="true">·</span>
      <span class="font-medium text-foreground tabular-nums">{view.versus}</span>
    {/if}
  </span>
</p>
