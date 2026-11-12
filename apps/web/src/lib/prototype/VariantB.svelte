<!-- PROTOTYPE Variant B "Floating hero": full-bleed scene, KPI glass floating over it, chart below the fold (the option ADR 21 rejected). -->
<script lang="ts" module>
  export const name = "Floating hero";
</script>

<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { LiveSim } from "./sim.svelte";
  import Hero from "./Hero.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import Meter from "./Meter.svelte";
  import DayChart from "./DayChart.svelte";
  import EvCard from "./EvCard.svelte";
  import WeatherRow from "./WeatherRow.svelte";
  import { eur } from "./format";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Button } from "#lib/components/ui/button/index.js";

  let { sim, dark, tod, onopen }: { sim: LiveSim; dark: boolean; tod: string; onopen: (id: string) => void } = $props();

  const kpis = $derived([
    { id: "production", label: "Produktion", value: sim.today.production, colour: "var(--e-solar)" },
    { id: "consumption", label: "Verbrauch", value: sim.today.consumption, colour: "var(--e-house)" },
    { id: "feedIn", label: "Einspeisung", value: sim.today.feedIn, colour: "var(--e-export)" },
    { id: "purchase", label: "Bezug", value: sim.today.purchase, colour: "var(--e-import)" },
  ]);
</script>

<div class="-ml-(--shell-pad)">
  <Hero {sim} {dark} {tod} onselect={onopen} framing="wide" presets="right" class="h-dvh">
    {#snippet overlay()}
      <div class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1 pt-6 text-center">
        <span class="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">Erzeugung jetzt</span>
        <span class="text-gradient text-6xl font-semibold tracking-tight md:text-7xl"><AnimatedNumber value={sim.pv} /><span class="ml-2 text-3xl text-muted-foreground">kW</span></span>
      </div>

      <!-- Floating KPI glass. -->
      <div class="absolute bottom-24 left-[calc(var(--shell-pad)+0.25rem)] hidden w-[300px] flex-col gap-2 md:flex">
        <Card.Root size="sm" class="glass-ambient elevation-3 px-4">
          <div class="mb-3 flex items-baseline justify-between">
            <span class="text-sm font-semibold">Heute</span>
            <span class="text-xs text-muted-foreground">gespart <span class="font-semibold text-foreground">{eur(sim.today.saved)}</span></span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            {#each kpis as k (k.id)}
              <Button variant="ghost" onclick={() => onopen(k.id)} class="h-auto flex-col items-start gap-0.5 px-1.5 py-1">
                <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span class="size-1.5 rounded-full" style:background={k.colour}></span>{k.label}</span>
                <span class="text-lg font-semibold"><AnimatedNumber value={k.value} /> <span class="text-xs text-muted-foreground">kWh</span></span>
              </Button>
            {/each}
          </div>
        </Card.Root>
        <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("autarky")} class="glass-ambient elevation-3 grid grid-cols-2 gap-4 px-4">
          <Meter label="Autarkie" value={sim.today.autarky} colour="var(--e-battery)" />
          <Meter label="Eigenverbr." value={sim.today.selfUse} colour="var(--e-solar)" />
        </Card.Root>
      </div>

      <div class="absolute top-20 right-4 hidden w-[260px] flex-col gap-2 md:flex">
        <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("price")} class="glass-ambient elevation-3 flex-row items-center justify-between px-4 py-3">
          <span class="text-xs text-muted-foreground">Spotpreis</span>
          <span class="text-lg font-semibold"><AnimatedNumber value={sim.price} /> <span class="text-xs text-muted-foreground">ct</span></span>
        </Card.Root>
        <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("forecast")} class="glass-ambient elevation-3 flex-row items-center justify-between px-4 py-3">
          <span class="text-xs text-muted-foreground">Noch erwartet</span>
          <span class="text-lg font-semibold"><AnimatedNumber value={sim.remaining} /> <span class="text-xs text-muted-foreground">kWh</span></span>
        </Card.Root>
        <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen("battery")} class="glass-ambient elevation-3 flex-row items-center justify-between px-4 py-3">
          <span class="text-xs text-muted-foreground">Batterie</span>
          <span class="text-lg font-semibold"><AnimatedNumber value={sim.soc} digits={0} /> <span class="text-xs text-muted-foreground">%</span></span>
        </Card.Root>
      </div>

      <div class="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center text-muted-foreground max-md:bottom-28">
        <span class="flex flex-col items-center text-[11px]">Mehr<ChevronDown class="size-4 motion-safe:animate-bounce" /></span>
      </div>
    {/snippet}
  </Hero>
</div>

<div class="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8">
  <!-- Phone: the KPIs land here. -->
  <div class="grid grid-cols-2 gap-2 md:hidden">
    {#each kpis as k (k.id)}
      <Card.Root size="sm" interactive role="button" tabindex={0} onclick={() => onopen(k.id)} class="glass-ambient gap-0 px-3.5 py-3">
        <span class="flex items-center gap-1.5 text-xs text-muted-foreground"><span class="size-1.5 rounded-full" style:background={k.colour}></span>{k.label}</span>
        <span class="text-xl font-semibold"><AnimatedNumber value={k.value} /> <span class="text-xs text-muted-foreground">kWh</span></span>
      </Card.Root>
    {/each}
  </div>
  <Card.Root class="glass-ambient">
    <Card.Header><Card.Title>Tagesverlauf</Card.Title></Card.Header>
    <Card.Content><DayChart data={sim.day} height={260} /></Card.Content>
  </Card.Root>
  <div class="grid gap-3 md:grid-cols-2">
    <WeatherRow {sim} {onopen} />
    <EvCard {sim} {onopen} />
  </div>
</div>
