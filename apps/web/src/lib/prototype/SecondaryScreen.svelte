<!-- PROTOTYPE: placeholder for History / Forecast / Tariff and the More screens. -->
<script lang="ts">
  import { SPOT, type LiveSim } from "./sim.svelte";
  import { NAV, type Screen } from "./nav";
  import DayChart from "./DayChart.svelte";
  import RangeControl from "./RangeControl.svelte";
  import * as Card from "#lib/components/ui/card/index.js";

  let { screen, sim }: { screen: Screen; sim: LiveSim } = $props();
  const item = $derived(NAV[screen]);
  const charted = $derived(screen === "history" || screen === "forecast" || screen === "tariff");
  const spotMax = Math.max(...SPOT);
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 lg:py-10">
  <header class="flex items-center gap-3 border-b border-foreground/[0.08] px-1 pb-4">
    <span class="grid size-10 place-items-center rounded-md bg-muted"><item.icon class="size-5" /></span>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">{item.label}</h1>
      <p class="text-xs text-muted-foreground">Platzhalter im Prototyp: nur Shell, Range-Control und Diagramm.</p>
    </div>
  </header>
  {#if charted}
    <RangeControl />
    <Card.Root class="glass-ambient px-4">
      {#if screen === "tariff"}
        <div class="flex h-[300px] items-end gap-1">
          {#each SPOT as p, h (h)}
            <span class="flex flex-1 flex-col items-center gap-1">
              <span class={["w-full rounded-sm", h === 15 ? "bg-foreground" : "bg-foreground/25"]} style:height="{(p / spotMax) * 260}px"></span>
              <span class="text-[9px] text-muted-foreground tabular-nums">{h % 3 === 0 ? h : ""}</span>
            </span>
          {/each}
        </div>
      {:else}
        <DayChart data={sim.day} height={320} metric={screen === "history" ? "house" : "pv"} />
      {/if}
    </Card.Root>
    <Card.Root size="sm" class="glass-ambient py-0"><dl class="grid grid-cols-2 divide-border/60 md:grid-cols-4 md:divide-x">
      {#each [["Produktion", "31,2 kWh"], ["Verbrauch", "14,8 kWh"], ["Einspeisung", "16,9 kWh"], ["Bezug", "0,6 kWh"]] as [k, v] (k)}
        <div class="flex flex-col gap-1 px-4 py-3"><dt class="text-xs text-muted-foreground">{k}</dt><dd class="text-lg font-semibold tabular-nums">{v}</dd></div>
      {/each}
    </dl></Card.Root>
  {:else}
    <Card.Root class="glass-ambient items-center py-10 text-muted-foreground">Nicht Teil dieser Frage.</Card.Root>
  {/if}
</div>
