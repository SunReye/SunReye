<!-- PROTOTYPE: minimal 2D power flow, the hero's fallback (ADR 11/20). -->
<script lang="ts">
  import Sun from "@lucide/svelte/icons/sun";
  import House from "@lucide/svelte/icons/house";
  import BatteryCharging from "@lucide/svelte/icons/battery-charging";
  import UtilityPole from "@lucide/svelte/icons/utility-pole";
  import Car from "@lucide/svelte/icons/car";
  import type { LiveSim } from "./sim.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";

  let { sim }: { sim: LiveSim } = $props();
  const nodes = $derived([
    { id: "pv", x: 50, y: 16, icon: Sun, colour: "var(--e-solar)", value: sim.pv, label: "PV" },
    { id: "bat", x: 16, y: 54, icon: BatteryCharging, colour: "var(--e-battery)", value: sim.battery, label: `Batterie · ${Math.round(sim.soc)} %` },
    { id: "grid", x: 84, y: 54, icon: UtilityPole, colour: "var(--e-export)", value: -sim.grid, label: "Einspeisung" },
    { id: "house", x: 50, y: 54, icon: House, colour: "var(--e-house)", value: sim.house, label: "Haus" },
    { id: "ev", x: 50, y: 88, icon: Car, colour: "var(--e-ev)", value: sim.ev, label: "EV" },
  ]);
</script>

<div class="absolute inset-0">
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="absolute inset-0 size-full" aria-hidden="true">
    {#each [["pv", "house", sim.pv, "var(--e-solar)"], ["house", "bat", sim.battery, "var(--e-battery)"], ["house", "grid", -sim.grid, "var(--e-export)"], ["house", "ev", sim.ev, "var(--e-ev)"]] as [a, b, w, c] (a + b)}
      {@const na = nodes.find((n) => n.id === a)!}
      {@const nb = nodes.find((n) => n.id === b)!}
      <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke={c as string} stroke-opacity="0.5" stroke-width={0.4 + (w as number) * 0.12} vector-effect="non-scaling-stroke" style:stroke-width="{1 + (w as number) * 0.7}px" stroke-linecap="round" />
    {/each}
  </svg>
  {#each nodes as n (n.id)}
    <div class="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style:left="{n.x}%" style:top="{n.y}%">
      <span class="glass-ambient grid size-14 place-items-center rounded-md ring-1 ring-border/60 elevation-2" style:color={n.colour}><n.icon class="size-6" /></span>
      <span class="glass-ambient flex flex-col items-center rounded-md px-2.5 py-1 ring-1 ring-border/60">
        <span class="text-sm font-semibold"><AnimatedNumber value={n.value} /> <span class="text-muted-foreground">kW</span></span>
        <span class="text-[11px] text-muted-foreground">{n.label}</span>
      </span>
    </div>
  {/each}
</div>
