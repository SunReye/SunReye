<!-- The range's highest powers, each with its hour or, over several days, the day it opens. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import GlassCard from "../components/glass-card.svelte";
  import { Pressable } from "../components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { formatPower } from "../power.ts";
  import type { Range } from "../range/range.ts";
  import type { Peak } from "./peaks.ts";

  let {
    label,
    peaks,
    onopen,
  }: {
    /** The range's label. */
    label: string;
    peaks: readonly Peak[];
    onopen: (range: Range) => void;
  } = $props();
</script>

{#snippet line(p: Peak)}
  <span class="size-2 shrink-0 rounded-[1px]" style:background={p.colour}></span>
  <span class="min-w-0 flex-1 text-sm">
    <span class="block">{p.label}</span>
    <span class="block text-xs text-muted-foreground tabular-nums">{p.when}</span>
  </span>
  <span class="text-sm font-semibold whitespace-nowrap tabular-nums">{formatPower(p.value)}</span>
{/snippet}

<GlassCard element="section" aria-label={m.stats_peaks()}>
  <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">
    {m.stats_peaks()} <span class="font-normal text-muted-foreground">· {label}</span>
  </h2>
  <ul class="divide-y divide-border/60 border-t border-border/60">
    {#each peaks as p (p.label)}
      <li>
        {#if p.range}
          {@const range = p.range}
          <Pressable
            feedback
            class="flex w-full items-baseline gap-2 px-4 py-2 text-left"
            aria-label={m.stats_peak_open({ name: p.label, day: p.when })}
            onclick={() => {
              haptics.soft();
              onopen(range);
            }}
          >
            {@render line(p)}
            <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
          </Pressable>
        {:else}
          <div class="flex items-baseline gap-2 px-4 py-2">{@render line(p)}</div>
        {/if}
      </li>
    {/each}
  </ul>
  <p class="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
    {m.stats_peaks_note()}
  </p>
</GlassCard>
