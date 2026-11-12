<!--
  The 2D power flow, the hero's 2D mode (ADR 21). Ported from v3 (dev 780b4e2,
  power-flow-diagram.svelte): portrait or landscape from the hero's aspect, anchors as fractions of
  a safe box inset by one caption stack, one comet per rail whose speed is the rail's share of the
  remembered plant peak, and the full, lite and still tiers.
-->
<script lang="ts">
  import Cpu from "@lucide/svelte/icons/cpu";
  import Gauge from "@lucide/svelte/icons/gauge";
  import type { LiveSim } from "../sim.svelte";
  import AnimatedNumber from "../AnimatedNumber.svelte";
  import FlowNode from "./FlowNode.svelte";
  import FlowRails, { type RailLine } from "./FlowRails.svelte";
  import { pulseShare, railPulse, throughputWatts } from "./flow-pulse";
  import { plantCeiling } from "./plant-ceiling.svelte";
  import { buildPowerGraph, type FlowReading, type NodeKind, type Pt } from "./power-graph";
  import { motion } from "../motion/tier.svelte";

  let {
    sim,
    onselect,
    top = 0,
  }: {
    sim: LiveSim;
    onselect?: (id: string) => void;
    /** Pixels the hero's own headline takes at the top; the safe box starts below them. */
    top?: number;
  } = $props();

  const short = (name: string) => name.replace("MPPT", "M").replace(" Süd", " S").replace(" Nord", " N").replace(" West", " W").replace(" Ost", " O");
  const loading = $derived(sim.status === "loading");
  // Before the first sample a role is known but its reading is not: NaN keeps the node and blanks the figure.
  const w3 = (kw: number) => (loading ? Number.NaN : kw * 1000);

  // A node shows only when its role exists (ADR 21).
  const reading = $derived<FlowReading>({
    strings: sim.strings.map((s) => ({ id: s.id, label: short(s.name), watts: w3(s.kw) })),
    pvTotal: w3(sim.pv),
    battery: sim.has.battery ? w3(-sim.battery) : undefined,
    grid: w3(sim.grid),
    load: w3(sim.house + sim.ev),
    charger: sim.has.ev ? { power: w3(sim.ev), connected: true, charging: sim.ev > 0.05, subtractFromHome: true } : undefined,
  });

  // The hero's aspect ratio picks the layout: tall boxes stack the diagram, wide ones fan it out.
  let ow = $state(0);
  let oh = $state(0);
  const orientation = $derived(ow > 0 && oh > 0 && ow / oh < 1.1 ? "portrait" : "landscape");

  // The safe box: the hero minus one caption stack on each side that carries text, so captions
  // never clip however short the hero gets. Rails render in real pixels, so its size is measured.
  let w = $state(0);
  let h = $state(0);
  // One caption stack (three lines and its margin) plus half a node box.
  const STACK = 64 + 8 + 32;
  const insets = $derived(
    orientation === "portrait" ? { top: top + STACK, bottom: STACK, side: 48 } : { top: top + 40, bottom: STACK, side: 64 },
  );

  // How many strings the box holds before they collapse into the one PV node: a caption is 96 px
  // wide in portrait, and a node with its caption is about 132 px tall in landscape.
  const fit = $derived(orientation === "portrait" ? Math.max(1, Math.floor((w + 96) / 104)) : Math.max(1, Math.floor((h * 0.78) / 132) + 1));
  const graph = $derived(buildPowerGraph(reading, orientation, w > 0 ? fit : 6));

  /** Segment pts → SVG path: 2 pts line, 3 quadratic, 4 cubic. */
  function toPath(px: Pt[]): string {
    const c = px.map((p) => `${p.x} ${p.y}`);
    if (px.length === 4) return `M ${c[0]} C ${c[1]}, ${c[2]}, ${c[3]}`;
    if (px.length === 3) return `M ${c[0]} Q ${c[1]}, ${c[2]}`;
    return `M ${c[0]} L ${c[1]}`;
  }
  const measured = $derived(w > 0 && h > 0);

  // The reference every rail is drawn against is the plant's remembered peak, folded on each
  // sample. An effect, not a derived: the ceiling is a memory of samples already gone.
  $effect(() => {
    void sim.tick;
    plantCeiling.observe(throughputWatts(graph.segments));
  });
  const ceiling = $derived(plantCeiling.watts);
  /** How hard the whole plant is working, 0..1, quantised to 1/20. */
  const plantLevel = $derived(pulseShare(throughputWatts(graph.segments), ceiling));

  const lines = $derived.by<RailLine[]>(() => {
    if (!measured) return [];
    return graph.segments.map((s) => ({
      id: s.id,
      flow: s.flow,
      color: s.color,
      pulse: railPulse(s.value, ceiling),
      d: toPath(s.pts.map((p) => ({ x: p.x * w, y: p.y * h }))),
    }));
  });
  // A stalled stream stops the charges with the numbers (ADR 21): the rails stay lit, nothing travels.
  const flowing = $derived(sim.status === "live" ? lines.filter((l) => l.flow !== "idle") : []);

  const socFor = (kind: NodeKind) => (loading ? undefined : kind === "battery" ? sim.soc : kind === "charger" ? sim.evSoc : undefined);
  const nodes = $derived(graph.nodes.map((n) => ({ node: n, soc: socFor(n.kind), share: pulseShare(n.value, ceiling) })));

  // The hub's own readings: total DC in, conversion efficiency and its own draw.
  const efficiency = $derived(sim.pv > 0.05 ? (sim.inverter / sim.pv) * 100 : 0);
  const selfUse = $derived(sim.pv > 0.05 ? Math.abs(sim.pv - sim.inverter) : 0.03);
</script>

<div class="absolute inset-0" bind:clientWidth={ow} bind:clientHeight={oh}>
  <!-- Soft ambience centred on the hub. Painted once; only its opacity follows the plant. -->
  <div
    class={["wash pointer-events-none absolute inset-0", motion.tier !== "full" && "wash-still"]}
    style="--plant-level:{plantLevel};background:radial-gradient(60% 55% at 50% {((insets.top + graph.hub.y * h) / Math.max(1, oh)) * 100}%, color-mix(in oklab, var(--foreground) 7%, transparent), transparent 75%)"
  ></div>

  <div class="absolute" style="top:{insets.top}px;bottom:{insets.bottom}px;left:{insets.side}px;right:{insets.side}px">
    <div class="relative size-full" bind:clientWidth={w} bind:clientHeight={h}>
      {#if measured}
        <FlowRails {lines} {flowing} width={w} height={h} />
      {/if}

      <!-- The inverter hub. Its metric pill floats above on a translucent backdrop so rails pass underneath. -->
      <div class="absolute -translate-x-1/2 -translate-y-1/2" style="left:{graph.hub.x * 100}%;top:{graph.hub.y * 100}%">
        {#if !loading && h >= 264}
          <dl class="absolute bottom-full left-1/2 mb-2.5 flex -translate-x-1/2 gap-4 rounded-md border border-border/60 bg-background/85 px-3 py-1.5 leading-tight whitespace-nowrap backdrop-blur-[2px]">
            <div class="flex flex-col items-center">
              <dd class="text-sm font-semibold text-solar"><AnimatedNumber value={sim.pv} /> <span class="text-xs font-normal text-muted-foreground">kW</span></dd>
              <dt class="text-xs text-muted-foreground">DC</dt>
            </div>
            {#if efficiency > 0}
              <div class="flex flex-col items-center">
                <dd class="flex items-center gap-1 text-sm font-semibold"><Gauge class="size-3 text-muted-foreground" /><AnimatedNumber value={efficiency} /> <span class="text-xs font-normal text-muted-foreground">%</span></dd>
                <dt class="text-xs text-muted-foreground">Wirkungsgrad</dt>
              </div>
            {/if}
            <div class="flex flex-col items-center max-sm:hidden">
              <dd class="text-sm font-medium"><AnimatedNumber value={selfUse * 1000} digits={0} /> <span class="text-xs font-normal text-muted-foreground">W</span></dd>
              <dt class="text-xs text-muted-foreground">Eigenbedarf</dt>
            </div>
          </dl>
        {/if}
        <button
          type="button"
          class="relative flex size-14 cursor-pointer items-center justify-center rounded-md border-2 border-foreground/70 bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] sm:size-16"
          aria-label="Wechselrichter: Details"
          onclick={() => onselect?.("inverter")}
        >
          <span class={["hub-ring absolute -inset-1 rounded-md border border-foreground/40", motion.tier !== "full" && "hub-still"]} style="--plant-level:{plantLevel}"></span>
          <Cpu class="size-6 sm:size-7" />
        </button>
      </div>

      {#each nodes as r (r.node.id)}
        <FlowNode {...r} {onselect} />
      {/each}
    </div>
  </div>
</div>

<style>
  /* Registered so the ring's keyframe reads it as a number; `inherits: false` so setting it on the
     ring and the wash cannot restyle a subtree every sample. */
  @property --plant-level {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }
  .wash {
    opacity: calc(0.4 + 0.6 * var(--plant-level));
    transition: opacity 900ms linear;
  }
  .wash-still {
    transition: none;
  }
  /* The ring beats only at `full`: same period at every load, the plant changes the amplitude. */
  .hub-ring {
    animation: hub-pulse 2.6s ease-in-out infinite;
  }
  .hub-still {
    animation: none;
  }
  @keyframes hub-pulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(1);
    }
    50% {
      opacity: calc(0.35 + 0.4 * var(--plant-level));
      transform: scale(calc(1 + 0.12 * var(--plant-level)));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hub-ring {
      animation: none;
    }
    .wash {
      transition: none;
    }
  }
</style>
