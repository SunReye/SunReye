<!--
  The rails between the flow's nodes: one cable per segment, carrying one comet charge.
  Ported from v3 (dev 780b4e2, power-flow-rails.svelte). The charge's speed is the magnitude; the
  crossing time is quantised in flow-pulse.ts, so an unchanged reading never restarts an animation.
  Tiers: full = comet chains, lite = one travelling dashed cable, still = a plain lit rail.
-->
<script lang="ts" module>
  import type { Flow } from "./power-graph";
  import type { RailPulse } from "./flow-pulse";

  export type RailLine = {
    id: string;
    flow: Flow;
    /** CSS colour driving `currentColor`. */
    color: string;
    pulse: RailPulse;
    d: string;
  };
</script>

<script lang="ts">
  import { fade } from "svelte/transition";
  import { motion } from "../motion/tier.svelte";
  import FlowCharge from "./FlowCharge.svelte";

  let { lines, flowing, width, height }: { lines: RailLine[]; flowing: RailLine[]; width: number; height: number } = $props();

  // A rail that reverses is a different group (the key carries the flow), so the old charge fades
  // out while the new one fades in instead of teleporting to the mirrored point.
  const fadeMs = $derived(motion.still ? 0 : 300);

  const overlayClass = (flow: Flow): string => {
    if (motion.still) return "";
    return flow === "out" ? "lite-flow lite-flow-out" : "lite-flow";
  };
  /** A lit rail states its magnitude even when it is standing still. */
  const overlayOpacity = (pulse: RailPulse): number => 0.4 + pulse.share * 0.48;

  // Scoped per instance so two diagrams on one page cannot capture each other's cables.
  const uid = $props.id();
  const cableId = (id: string): string => `${uid}-cable-${id}`;
</script>

<!-- `overflow-visible`: a charge's bloom is wider than the charge, and the SVG is inset from the hero. -->
<svg class="absolute inset-0 overflow-visible" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
  <!-- Cables first, so an idle rail never overpaints a lit one where routes cross. -->
  {#each lines as l (l.id)}
    <path id={cableId(l.id)} class="text-foreground/12" d={l.d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  {/each}
  {#each flowing as l (`${l.id}-${l.flow}`)}
    <g style:color={l.color} transition:fade={{ duration: fadeMs }}>
      {#if motion.tier === "full"}
        <path d={l.d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity={0.18 + l.pulse.share * 0.3} />
        <FlowCharge pulse={l.pulse} flow={l.flow} cable={cableId(l.id)} />
      {:else}
        <path
          class={overlayClass(l.flow)}
          d={l.d}
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-width={l.pulse.width}
          stroke-opacity={overlayOpacity(l.pulse)}
          style={motion.still ? "" : `--flow-dur:${l.pulse.dur}s`}
        />
      {/if}
    </g>
  {/each}
</svg>

<style>
  /* One thin stroke per rail. The dash cycle is 24 user units, which is what the keyframe moves by. */
  .lite-flow {
    stroke-dasharray: 10 14;
    /* Stepped: 12 repaints a crossing instead of 60 a second, and it still reads as travel. */
    animation: flow-dash var(--flow-dur, 2s) steps(12, end) infinite;
  }
  .lite-flow-out {
    animation-direction: reverse;
  }
  @keyframes flow-dash {
    to {
      stroke-dashoffset: -24;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lite-flow,
    .lite-flow-out {
      animation: none;
    }
  }
</style>
