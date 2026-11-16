<!--
  The chart's legend and readout in one (ADR 21): each series' value under the pointer, or its
  latest; nothing floats under a finger.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { Figure } from "./series-chart.ts";

  let { title, figures }: { title: string; figures: readonly Figure[] } = $props();
</script>

<div class="flex flex-col gap-1.5" aria-live="polite">
  <p class="truncate text-base font-semibold tabular-nums">{title}</p>
  <ul
    class="grid gap-x-6 gap-y-0.5 text-[13px] leading-[1.125rem] @[520px]:grid-cols-2 @[520px]:text-xs"
    aria-label={m.explore_series_chart()}
  >
    {#each figures as f (f.key)}
      <li class="flex min-w-0 items-baseline gap-1.5">
        <span
          class="size-2 shrink-0 translate-y-[-1px] rounded-[1px]"
          style:background={f.colour}
        ></span>
        <span class="min-w-0 truncate text-muted-foreground">
          <span class="text-foreground">{f.label}</span> · {f.device}
        </span>
        <span class="ml-auto shrink-0 pl-3 whitespace-nowrap tabular-nums">
          {#if f.extremes}<span class="mr-1.5 text-muted-foreground">{f.extremes}</span>{/if}
          <span class="font-semibold">{f.value}</span>
        </span>
      </li>
    {/each}
  </ul>
</div>
