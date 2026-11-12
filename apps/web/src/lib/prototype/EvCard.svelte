<script lang="ts">
  import Car from "@lucide/svelte/icons/car";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import type { LiveSim } from "./sim.svelte";
  let { sim, onopen, class: className = "" }: { sim: LiveSim; onopen: (id: string) => void; class?: string } = $props();
</script>

<Card.Root
  size="sm"
  interactive
  role="button"
  tabindex={0}
  onclick={() => onopen("ev")}
  onkeydown={(e: KeyboardEvent) => e.key === "Enter" && onopen("ev")}
  class="glass-ambient flex-row items-center gap-3 px-4 py-3 {className}"
>
  <span class="grid size-9 shrink-0 place-items-center rounded-md bg-ev/15 text-ev"><Car class="size-5" /></span>
  <span class="flex min-w-0 flex-1 flex-col gap-1.5">
    <span class="flex items-center gap-2 text-sm">
      <span class="font-semibold">ID.4</span>
      <Badge variant="secondary">PV-Modus</Badge>
      <span class="truncate text-xs text-muted-foreground">lädt · fertig ≈ 17:20</span>
      <span class="ml-auto font-semibold whitespace-nowrap"><AnimatedNumber value={sim.ev} /> <span class="text-xs font-medium text-muted-foreground">kW</span></span>
    </span>
    <Progress value={sim.evSoc} size="square" class="ev" aria-label="Ladestand" />
    <span class="flex justify-between text-[11px] text-muted-foreground tabular-nums"><span><AnimatedNumber value={sim.evSoc} digits={0} /> %</span><span>Ziel 80 %</span></span>
  </span>
</Card.Root>

<style>
  :global(.ev > [data-slot="progress-indicator"]) {
    background: var(--e-ev);
    transition-duration: 2200ms;
  }
</style>
