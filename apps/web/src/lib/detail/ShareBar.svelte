<!-- One composition bar of the autarky sheet (ADR 21 "Sheet content"): what a whole split into
  over the range, its parts' shares beside their keys. Without a whole, an empty track and dashes. -->
<script lang="ts">
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import { kwh, num } from "../range/format.ts";
  import type { Part } from "./autarky.ts";

  let {
    title,
    total,
    parts,
  }: {
    title: string;
    /** The whole, in kWh. */
    total: number;
    /** Each part; null shares without a whole. */
    parts: readonly Part[];
  } = $props();
</script>

<div class="flex flex-col gap-1.5" role="group" aria-label={title}>
  <div class="flex items-baseline justify-between gap-3 text-xs">
    <span class="font-medium">{title}</span>
    <span class="text-muted-foreground tabular-nums">{kwh(total)}</span>
  </div>
  <ChartEntrance build="draw" ready={parts.some((p) => p.share)}>
    <div class="flex h-2 gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {#each parts as p (p.label)}
        {#if p.share}
          <span class="h-full" style:width="{p.share}%" style:background={p.colour}></span>
        {/if}
      {/each}
    </div>
  </ChartEntrance>
  <ul class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
    {#each parts as p (p.label)}
      <li class="flex items-center gap-1.5">
        <span class="size-2 shrink-0 rounded-[1px]" style:background={p.colour}></span>
        <span class="text-muted-foreground">{p.label}</span>
        <span class="font-medium tabular-nums">{p.share === null ? "–" : `${num(p.share)} %`}</span>
      </li>
    {/each}
  </ul>
</div>
