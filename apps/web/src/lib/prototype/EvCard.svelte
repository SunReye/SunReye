<script lang="ts">
  import Car from "@lucide/svelte/icons/car";
  import * as Card from "#lib/components/ui/card/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import type { LiveSim } from "./sim.svelte";
  let { sim, onopen }: { sim: LiveSim; onopen: (id: string) => void } = $props();

  const loading = $derived(sim.status === "loading");
  const charging = $derived(sim.ev > 0.05);
</script>

<Card.Root size="sm" class="glass-ambient shrink-0 gap-0 py-0">
  <button
    type="button"
    class="flex items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/[0.08]"
    onclick={() => onopen("ev")}
  >
    <span class="grid size-9 shrink-0 place-items-center rounded-md bg-ev/15 text-ev"><Car class="size-5" /></span>
    <span class="flex min-w-0 flex-1 flex-col gap-1.5">
      <span class="flex items-baseline gap-2">
        <span class="min-w-0 truncate text-sm font-semibold">{sim.evName}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{charging ? "PV-Modus · fertig ≈ 17:20" : "angesteckt · wartet auf PV"}</span>
        <span class="text-base font-semibold whitespace-nowrap"><AnimatedNumber value={loading ? null : sim.ev} /> <span class="text-xs font-medium text-muted-foreground">kW</span></span>
      </span>
      <Progress value={loading ? 0 : sim.evSoc} size="square" class="ev" aria-label="Ladestand" />
      <span class="flex justify-between text-xs text-muted-foreground tabular-nums"><span><AnimatedNumber value={loading ? null : sim.evSoc} digits={0} /> %</span><span>Ziel 80 %</span></span>
    </span>
  </button>
</Card.Root>

<style>
  :global(.ev > [data-slot="progress-indicator"]) {
    background: var(--e-ev);
    transition-duration: 2200ms;
  }
</style>
