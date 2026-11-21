<!--
  The 2D power flow, the hero's 2D mode (ADR 21). Ported from v3 (dev 780b4e2,
  power-flow-diagram.svelte): portrait or landscape from the hero's aspect, anchors as fractions of
  a safe box inset by one caption stack, one comet per rail whose speed is the rail's share of the
  remembered plant peak, and the full, lite and still tiers.
-->
<script lang="ts">
  import type { Core, Live } from "../api/core.ts";
  import { estimatedSeries, layoutStrings } from "../live/plant-facts.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { pulseShare, railPulse, throughputWatts } from "./flow-pulse.ts";
  import FlowHub from "./FlowHub.svelte";
  import FlowNode from "./FlowNode.svelte";
  import FlowRails from "./FlowRails.svelte";
  import { plantCeiling } from "./plant-ceiling.svelte.ts";
  import { buildPowerGraph, railPath } from "./power-graph.ts";
  import { flowReading, hubMetrics, stalled, type FlowStrings } from "./reading.ts";

  let {
    core,
    live,
    onselect,
    top = 0,
  }: {
    core: Pick<Core, "layout" | "capabilities">;
    /** Undefined until the stream first answers. */
    live: Live | undefined;
    onselect: (id: string) => void;
    /** Pixels the hero's own headline takes at the top; the safe box starts below them. */
    top?: number;
  } = $props();

  let strings = $state.raw<FlowStrings>([]);
  let estimated = $state.raw<Readonly<Record<string, readonly string[] | undefined>>>({});

  $effect(() => {
    void layoutStrings(core).then((next) => (strings = next));
    void estimatedSeries(core).then((next) => (estimated = next));
  });

  const values = $derived(live !== undefined && "devices" in live ? live.devices : {});

  // A stalled plant or a lost stream stops the charges with the numbers (ADR 21): the rails stay
  // lit, nothing travels.
  const still = $derived(stalled(live));

  // A node shows only when its role exists (ADR 21).
  const reading = $derived(flowReading(values, strings, estimated));

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
    orientation === "portrait"
      ? { top: top + STACK, bottom: STACK, side: 48 }
      : { top: top + 40, bottom: STACK, side: 64 },
  );

  // How many strings the box holds before they collapse into the one PV node: a caption is 96 px
  // wide in portrait, and a node with its caption is about 132 px tall in landscape.
  const fit = $derived(
    orientation === "portrait"
      ? Math.max(1, Math.floor((w + 96) / 104))
      : Math.max(1, Math.floor((h * 0.78) / 132) + 1),
  );

  const graph = $derived(buildPowerGraph(reading, orientation, w > 0 ? fit : 6));

  const measured = $derived(w > 0 && h > 0);

  // The reference every rail is drawn against is the plant's remembered peak, folded on each
  // sample. An effect, not a derived: the ceiling is a memory of samples already gone.
  $effect(() => {
    plantCeiling.observe(throughputWatts(graph.segments));
  });

  const ceiling = $derived(plantCeiling.watts);

  /** How hard the whole plant is working, 0..1, quantised to 1/20. */
  const plantLevel = $derived(pulseShare(throughputWatts(graph.segments), ceiling));

  const lines = $derived.by(() => {
    if (!measured) return [];

    return graph.segments.map((s) => ({
      id: s.id,
      flow: s.flow,
      color: s.color,
      pulse: railPulse(s.value, ceiling),
      d: railPath(s.pts, w, h),
    }));
  });

  const flowing = $derived(still ? [] : lines.filter((l) => l.flow !== "idle"));

  const nodes = $derived(
    graph.nodes.map((n) => ({ node: n, soc: n.soc, share: pulseShare(n.value, ceiling) })),
  );

  // The hub's own readings: total DC in, conversion efficiency and its own draw.
  const hub = $derived(hubMetrics(values));
</script>

<div class="absolute inset-0" bind:clientWidth={ow} bind:clientHeight={oh}>
  <!-- Soft ambience centred on the hub. Painted once; only its opacity follows the plant. -->
  <div
    class={["wash pointer-events-none absolute inset-0", motion.tier !== "full" && "wash-still"]}
    style="--plant-level:{plantLevel};background:radial-gradient(60% 55% at 50% {((insets.top +
      graph.hub.y * h) /
      Math.max(1, oh)) *
      100}%, color-mix(in oklab, var(--foreground) 7%, transparent), transparent 75%)"
  ></div>

  <div
    class="absolute"
    style="top:{insets.top}px;bottom:{insets.bottom}px;left:{insets.side}px;right:{insets.side}px"
  >
    <div class="relative size-full" bind:clientWidth={w} bind:clientHeight={h}>
      {#if measured}
        <FlowRails {lines} {flowing} tier={motion.tier} width={w} height={h} />
      {/if}

      <FlowHub at={graph.hub} {hub} {plantLevel} tier={motion.tier} pill={h >= 264} {onselect} />

      {#each nodes as r (r.node.id)}
        <FlowNode {...r} tier={motion.tier} {onselect} />
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
    transition: opacity var(--motion-flow-wash) linear;
  }
  .wash-still {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .wash {
      transition: none;
    }
  }
</style>
