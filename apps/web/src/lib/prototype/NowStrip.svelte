<!-- PROTOTYPE: the "now" strip (ADR 21): price, PV still to come and the weather, one surface divided by hairlines. -->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import type { LiveSim } from "./sim.svelte";
  let { sim, onopen }: { sim: LiveSim; onopen: (id: string) => void } = $props();

  const loading = $derived(sim.status === "loading");
  // The word carries the judgement; the colour only repeats it.
  const level = $derived(sim.price < 15 ? { word: "günstig", cls: "text-success" } : sim.price > 25 ? { word: "teuer", cls: "text-warning" } : { word: "normal", cls: "text-muted-foreground" });
  const cell = "flex min-w-0 flex-col items-start gap-0.5 px-3 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/[0.08] sm:px-4";
  const label = "max-w-full truncate text-xs font-medium text-muted-foreground";
  const figure = "text-xl leading-tight font-semibold tracking-tight whitespace-nowrap";
  const unit = "text-xs font-medium text-muted-foreground";
  const sub = "max-w-full truncate text-xs text-muted-foreground";
</script>

<Card.Root size="sm" class="glass-ambient grid shrink-0 grid-cols-3 gap-0 divide-x divide-border/60 py-0" role="group" aria-label="Jetzt">
  <button type="button" class={cell} onclick={() => onopen("price")}>
    <span class={label}>Spotpreis</span>
    <span class={figure}><AnimatedNumber value={loading ? null : sim.price} /> <span class={unit}>ct/kWh</span></span>
    <span class="{sub} {loading ? '' : level.cls}">{loading ? "\u00a0" : level.word}</span>
  </button>
  <button type="button" class={cell} onclick={() => onopen("forecast")}>
    <span class={label}>PV noch heute</span>
    <span class={figure}><AnimatedNumber value={loading ? null : sim.remaining} /> <span class={unit}>kWh</span></span>
    <span class={sub}>von 49,7 kWh</span>
  </button>
  <button type="button" class={cell} onclick={() => onopen("weather")}>
    <span class={label}>Wetter</span>
    <span class={figure}>{sim.weather.temp} <span class={unit}>°C</span></span>
    <span class={sub}>{sim.weather.label}</span>
  </button>
</Card.Root>
