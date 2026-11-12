<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  let { label, value, colour, hint }: { label: string; value: number; colour: string; hint?: string } = $props();
</script>

<div class="flex min-w-0 flex-col gap-1.5" style:--meter={colour}>
  <div class="flex items-baseline justify-between gap-2 text-xs">
    <span class="font-medium text-muted-foreground">{label}</span>
    <span class="text-sm font-semibold"><AnimatedNumber {value} digits={0} /> %</span>
  </div>
  <Progress {value} size="square" class="meter" aria-label={label} />
  {#if hint}<span class="text-[11px] text-muted-foreground">{hint}</span>{/if}
</div>

<style>
  /* The registry's Progress has no data tones: the energy colour and the live glide are set here. */
  div :global(.meter > [data-slot="progress-indicator"]) {
    background: var(--meter);
    transition-duration: 2200ms;
  }
</style>
