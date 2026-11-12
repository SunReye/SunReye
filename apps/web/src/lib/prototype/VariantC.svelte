<!-- PROTOTYPE Variant C "Bento": the scene is one tile among analytics tiles; KPIs in a hairline strip. -->
<script lang="ts" module>
  export const name = "Bento";
</script>

<script lang="ts">
  import type { LiveSim } from "./sim.svelte";
  import { SPOT } from "./sim.svelte";
  import Hero from "./Hero.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import DayChart from "./DayChart.svelte";
  import EvCard from "./EvCard.svelte";
  import Meter from "./Meter.svelte";
  import { eur } from "./format";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";

  let { sim, dark, tod, onopen }: { sim: LiveSim; dark: boolean; tod: string; onopen: (id: string) => void } = $props();

  const strip = $derived([
    { id: "production", label: "Erzeugung", value: sim.pv, unit: "kW", colour: "var(--e-solar)", d: 1 },
    { id: "consumption", label: "Haus", value: sim.house, unit: "kW", colour: "var(--e-house)", d: 1 },
    { id: "battery", label: "Batterie ↑", value: sim.battery, unit: "kW", colour: "var(--e-battery)", d: 1 },
    { id: "feedIn", label: "Netz ↑", value: -sim.grid, unit: "kW", colour: "var(--e-export)", d: 1 },
    { id: "autarky", label: "Autarkie", value: sim.today.autarky, unit: "%", colour: "var(--e-battery)", d: 0 },
    { id: "saved", label: "Gespart", value: sim.today.saved, unit: "€", colour: "var(--e-solar)", d: 2 },
  ]);
  const spotMax = Math.max(...SPOT);
  const hour = 15;
</script>

<div class="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4 lg:py-6 lg:pr-6 lg:pl-0">
  <header class="flex items-end justify-between px-1">
    <div>
      <p class="text-xs text-muted-foreground">Dienstag, 10. November · 15:00</p>
      <h1 class="text-2xl font-semibold tracking-tight">Anlage</h1>
    </div>
    <Badge variant="outline" class="gap-1.5"><span class="size-1.5 rounded-full bg-success"></span>Live</Badge>
  </header>

  <!-- Hairline stat strip. -->
  <Card.Root size="sm" class="glass-ambient py-0">
  <dl class="grid grid-cols-3 md:grid-cols-6">
    {#each strip as s, i (s.id)}
      <div class={["p-1", i > 0 && "md:border-l md:border-border/60", i % 3 > 0 && "max-md:border-l max-md:border-border/60", i >= 3 && "max-md:border-t max-md:border-border/60"]}>
      <Button variant="ghost" onclick={() => onopen(s.id)} class="h-auto w-full flex-col items-start gap-1 px-3 py-2">
        <dt class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><span class="size-1.5 rounded-full" style:background={s.colour}></span>{s.label}</dt>
        <dd class="text-xl leading-none font-semibold tracking-tight"><AnimatedNumber value={s.value} digits={s.d} /><span class="ml-1 text-xs font-medium text-muted-foreground">{s.unit}</span></dd>
      </Button>
      </div>
    {/each}
  </dl>
  </Card.Root>

  <div class="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-cols-12 lg:grid-rows-[260px_220px_auto]">
    <Card.Root class="glass-ambient relative py-0 md:col-span-6 lg:col-span-7 lg:row-span-2">
      <Hero {sim} {dark} {tod} onselect={onopen} class="h-[420px] lg:h-full" />
    </Card.Root>

    <Card.Root interactive role="button" tabindex={0} onclick={() => onopen("production")} class="glass-ambient flex flex-col px-4 py-4 md:col-span-6 lg:col-span-5">
      <span class="flex items-baseline justify-between text-sm"><span class="font-semibold">Erzeugung heute</span><span class="text-muted-foreground tabular-nums"><AnimatedNumber value={sim.today.production} /> / ≈ 49,7 kWh</span></span>
      <span class="relative mt-2 block flex-1"><span class="absolute inset-0"><DayChart data={sim.day} height={0} /></span></span>
    </Card.Root>

    <Card.Root interactive role="button" tabindex={0} onclick={() => onopen("s1")} class="glass-ambient flex flex-col gap-3 px-4 py-4 md:col-span-3 lg:col-span-3">
      <span class="text-sm font-semibold">Strings</span>
      {#each sim.strings as s (s.id)}
        <span class="flex flex-col gap-1">
          <span class="flex justify-between text-xs"><span class="text-muted-foreground">{s.name}</span><span class="font-medium tabular-nums"><AnimatedNumber value={s.kw} /> kW</span></span>
          <span class="h-2 overflow-hidden bg-muted">
            <span class="block h-full origin-left bg-linear-to-r from-amber-600 to-amber-300 transition-transform duration-[2200ms] ease-out" style:transform="scaleX({s.kw / s.peak})"></span>
          </span>
        </span>
      {/each}
      <span class="mt-auto text-[11px] text-muted-foreground">Anteil an der eigenen Spitze</span>
    </Card.Root>

    <Card.Root interactive role="button" tabindex={0} onclick={() => onopen("price")} class="glass-ambient flex flex-col px-4 py-4 md:col-span-3 lg:col-span-2">
      <span class="text-sm font-semibold">Spotpreis</span>
      <span class="text-2xl font-semibold tracking-tight"><AnimatedNumber value={sim.price} /> <span class="text-xs text-muted-foreground">ct</span></span>
      <span class="mt-auto flex h-20 items-end gap-[2px]">
        {#each SPOT as p, h (h)}
          <span class={["flex-1 origin-bottom rounded-sm", h === hour ? "bg-foreground" : h < hour ? "bg-foreground/15" : "bg-foreground/30"]} style:height="{(p / spotMax) * 100}%"></span>
        {/each}
      </span>
    </Card.Root>

    <Card.Root interactive role="button" tabindex={0} onclick={() => onopen("autarky")} class="glass-ambient flex flex-col gap-4 px-4 py-4 md:col-span-3 lg:col-span-4">
      <span class="flex items-baseline justify-between text-sm"><span class="font-semibold">Bilanz heute</span><span class="text-xs text-muted-foreground">gespart {eur(sim.today.saved)}</span></span>
      <Meter label="Autarkie" value={sim.today.autarky} colour="var(--e-battery)" hint="0,6 kWh aus dem Netz" />
      <Meter label="Eigenverbrauch" value={sim.today.selfUse} colour="var(--e-solar)" hint="16,9 kWh eingespeist" />
    </Card.Root>

    <div class="md:col-span-3 lg:col-span-4"><EvCard {sim} {onopen} class="h-full w-full" /></div>

    <Card.Root interactive role="button" tabindex={0} onclick={() => onopen("battery")} class="glass-ambient flex-row items-center gap-4 px-4 py-4 md:col-span-6 lg:col-span-4">
      <span class="relative h-16 w-9 overflow-hidden rounded-sm bg-muted ring-1 ring-border/60">
        <span class="absolute inset-0 origin-bottom bg-battery transition-transform duration-[2200ms] ease-out" style:transform="scaleY({sim.soc / 100})"></span>
      </span>
      <span class="flex flex-col">
        <span class="text-xs text-muted-foreground">Batterie lädt</span>
        <span class="text-2xl font-semibold"><AnimatedNumber value={sim.soc} digits={0} /> %</span>
        <span class="text-xs text-muted-foreground tabular-nums">↑ <AnimatedNumber value={sim.battery} /> kW · voll ≈ 16:45</span>
      </span>
    </Card.Root>
  </div>
</div>
