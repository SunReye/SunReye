<!--
  PROTOTYPE: today's energy (ADR 21) as one surface: the four figures with their money, the autarky
  and self-consumption meters and the day curve, divided by hairlines. Every part opens its detail.
-->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import Meter from "./Meter.svelte";
  import DayChart from "./DayChart.svelte";
  import { eur } from "./format";
  import type { LiveSim } from "./sim.svelte";

  let { sim, onopen }: { sim: LiveSim; onopen: (id: string) => void } = $props();

  const loading = $derived(sim.status === "loading");
  const t = $derived(sim.today);
  const figures = $derived([
    { id: "production", label: "Produktion", value: t.production, colour: "var(--e-solar)", sub: "Spitze 8,6 kW um 13:30" },
    { id: "consumption", label: "Verbrauch", value: t.consumption, colour: "var(--e-house)", sub: `ohne PV ${eur(t.consumption * 0.32)}` },
    { id: "feedIn", label: "Einspeisung", value: t.feedIn, colour: "var(--e-export)", sub: `+ ${eur(t.feedIn * 0.082)} · 8,2 ct` },
    { id: "purchase", label: "Bezug", value: t.purchase, colour: "var(--e-import)", sub: `− ${eur(t.purchase * 0.32)} · 32 ct` },
  ]);
  const press = "outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/[0.08]";
</script>

<Card.Root size="sm" class="glass-ambient @container min-h-0 gap-0 py-0 lg:flex-1" role="group" aria-label="Heute">
  <div class="flex shrink-0 items-center justify-between gap-3 pl-4">
    <h2 class="text-sm font-semibold">Heute</h2>
    <button type="button" class="flex items-baseline gap-2 px-4 py-2.5 {press}" onclick={() => onopen("saved")}>
      <span class="text-xs text-muted-foreground">gespart</span>
      <span class="text-base font-semibold tabular-nums">{loading ? "–,–– €" : eur(t.saved)}</span>
    </button>
  </div>

  <div class="grid shrink-0 grid-cols-2">
    {#each figures as f, i (f.id)}
      <button type="button" class={["flex min-w-0 flex-col items-start gap-1 border-t border-border/60 px-4 py-3 text-left @[560px]:py-4", i % 2 === 1 && "border-l", press]} onclick={() => onopen(f.id)}>
        <span class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><span class="size-2 rounded-[1px]" style:background={f.colour}></span>{f.label}</span>
        <span class="text-2xl leading-none font-semibold tracking-tight whitespace-nowrap @[560px]:text-3xl">
          <AnimatedNumber value={loading ? null : f.value} /><span class="ml-1 text-sm font-medium text-muted-foreground">kWh</span>
        </span>
        <span class="max-w-full truncate text-xs text-muted-foreground tabular-nums">{loading ? "\u00a0" : f.sub}</span>
      </button>
    {/each}
  </div>

  <button type="button" class="grid shrink-0 grid-cols-2 gap-6 border-t border-border/60 px-4 py-3 text-left {press}" onclick={() => onopen("autarky")}>
    <Meter label="Autarkie" value={loading ? null : t.autarky} colour="var(--e-battery)" />
    <Meter label="Eigenverbrauch" value={loading ? null : t.selfUse} colour="var(--e-solar)" />
  </button>

  <button type="button" class="flex min-h-0 flex-col gap-1 border-t border-border/60 px-4 pt-3 pb-2 text-left max-lg:h-52 lg:min-h-[132px] lg:flex-1 {press}" onclick={() => onopen("production")} aria-label="Tagesverlauf: Details">
    <span class="flex shrink-0 items-center gap-3 text-xs">
      <span class="font-medium text-muted-foreground">Tagesverlauf</span>
      <span class="flex items-center gap-1.5 text-muted-foreground"><span class="h-0.5 w-3 bg-solar"></span>Ist</span>
      <span class="flex items-center gap-1.5 text-muted-foreground"><span class="h-0 w-3 border-t border-dashed border-solar"></span>Prognose</span>
      <span class="ml-auto text-muted-foreground">kW</span>
    </span>
    <span class="relative block min-h-0 w-full flex-1">
      <span class="absolute inset-0"><DayChart data={sim.day} height={0} /></span>
    </span>
  </button>
</Card.Root>
