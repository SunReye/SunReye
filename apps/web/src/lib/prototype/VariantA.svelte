<!-- PROTOTYPE Variant A "ADR 21": master's two-column dashboard, non-scrolling on desktop. -->
<script lang="ts" module>
  export const name = "ADR 21";
</script>

<script lang="ts">
  import type { LiveSim } from "./sim.svelte";
  import Hero from "./Hero.svelte";
  import NowStrip from "./NowStrip.svelte";
  import WeatherRow from "./WeatherRow.svelte";
  import EnergyCard from "./EnergyCard.svelte";
  import Meter from "./Meter.svelte";
  import DayChart from "./DayChart.svelte";
  import EvCard from "./EvCard.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import { eur } from "./format";
  import * as Card from "#lib/components/ui/card/index.js";

  let { sim, dark, tod, onopen }: { sim: LiveSim; dark: boolean; tod: string; onopen: (id: string) => void } = $props();
</script>

<div class="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pt-4 lg:grid lg:h-dvh lg:grid-cols-[53fr_47fr] lg:gap-6 lg:py-6 lg:pr-6 lg:pl-0">
  <Hero {sim} {dark} {tod} onselect={onopen} class="h-[58dvh] min-h-[360px] overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1 lg:h-auto">
    {#snippet overlay()}
      <div class="pointer-events-none absolute top-3 left-3 flex flex-col gap-0.5 lg:top-4 lg:left-4">
        <span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Erzeugung jetzt</span>
        <span class="text-gradient text-4xl font-semibold tracking-tight lg:text-5xl"><AnimatedNumber value={sim.pv} /> <span class="text-2xl text-muted-foreground lg:text-3xl">kW</span></span>
        <span class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
          <span><span class="text-house">●</span> Haus <AnimatedNumber value={sim.house} /> kW</span>
          <span><span class="text-export">●</span> Netz ↑ <AnimatedNumber value={-sim.grid} /> kW</span>
        </span>
      </div>
    {/snippet}
  </Hero>

  <div class="flex min-h-0 flex-col gap-2.5">
    <NowStrip {sim} {onopen} />
    <WeatherRow {sim} {onopen} />

    <section aria-label="Heute" class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between px-1">
        <h2 class="text-sm font-semibold">Heute</h2>
        <span class="text-xs text-muted-foreground">gespart <span class="font-semibold text-foreground tabular-nums">{eur(sim.today.saved)}</span></span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <EnergyCard label="Produktion" value={sim.today.production} colour="var(--e-solar)" onclick={() => onopen("production")}>
          {#snippet sub()}Spitze 8,6 kW um 13:30{/snippet}
        </EnergyCard>
        <EnergyCard label="Verbrauch" value={sim.today.consumption} colour="var(--e-house)" onclick={() => onopen("consumption")}>
          {#snippet sub()}Kosten {eur(0.19)} · ohne PV {eur(4.74)}{/snippet}
        </EnergyCard>
        <EnergyCard label="Einspeisung" value={sim.today.feedIn} colour="var(--e-export)" onclick={() => onopen("feedIn")}>
          {#snippet sub()}+ {eur(sim.today.feedIn * 0.082)} · 8,2 ct/kWh{/snippet}
        </EnergyCard>
        <EnergyCard label="Bezug" value={sim.today.purchase} colour="var(--e-import)" onclick={() => onopen("purchase")}>
          {#snippet sub()}− {eur(sim.today.purchase * 0.32)} · 32 ct/kWh{/snippet}
        </EnergyCard>
      </div>
      <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("autarky")} class="glass-ambient grid grid-cols-2 gap-5 px-4 py-3">
        <Meter label="Autarkie" value={sim.today.autarky} colour="var(--e-battery)" />
        <Meter label="Eigenverbrauch" value={sim.today.selfUse} colour="var(--e-solar)" />
      </Card.Root>
    </section>

    <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("production")} class="glass-ambient min-h-[120px] flex-1 gap-1 px-3 pt-3 pb-2">
      <span class="flex items-center gap-3 px-1 text-xs">
        <span class="font-semibold">Tagesverlauf</span>
        <span class="flex items-center gap-1 text-muted-foreground"><span class="h-0.5 w-3 bg-solar"></span>Ist</span>
        <span class="flex items-center gap-1 text-muted-foreground"><span class="h-0 w-3 border-t border-dashed border-solar"></span>Prognose</span>
        <span class="ml-auto text-muted-foreground">kW</span>
      </span>
      <span class="relative mt-1 block min-h-0 flex-1">
        <span class="absolute inset-0"><DayChart data={sim.day} height={0} /></span>
      </span>
    </Card.Root>

    <EvCard {sim} {onopen} />
  </div>
</div>
