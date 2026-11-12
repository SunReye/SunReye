<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  let { label, value, colour }: { label: string; value: number | null; colour: string } = $props();
</script>

<div class="flex min-w-0 flex-col gap-1.5" style:--meter={colour}>
  <div class="flex items-baseline justify-between gap-2 text-xs">
    <span class="truncate font-medium text-muted-foreground">{label}</span>
    <span class="text-sm font-semibold whitespace-nowrap"><AnimatedNumber {value} digits={0} /> %</span>
  </div>
  <Progress value={value ?? 0} size="square" class="meter" aria-label={label} />
</div>

<style>
  /* The registry's Progress has no data tones: the energy colour and the live glide are set here. */
  div :global(.meter > [data-slot="progress-indicator"]) {
    background: var(--meter);
    transition-duration: 2200ms;
  }
</style>
