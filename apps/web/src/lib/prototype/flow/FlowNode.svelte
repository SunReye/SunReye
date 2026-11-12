<!--
  One node of the 2D flow. Ported from v3 (dev 780b4e2, power-flow-node.svelte) and restyled:
  a boxy tile in the node's energy colour, the SOC as the tile's content with a square gauge traced
  inside it, and a caption stack that names the node, its power and its direction. Tapping opens
  the node's detail sheet.
-->
<script lang="ts">
  import type { Component } from "svelte";
  import Sun from "@lucide/svelte/icons/sun";
  import BatteryCharging from "@lucide/svelte/icons/battery-charging";
  import UtilityPole from "@lucide/svelte/icons/utility-pole";
  import House from "@lucide/svelte/icons/house";
  import Fuel from "@lucide/svelte/icons/fuel";
  import Car from "@lucide/svelte/icons/car";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import AnimatedNumber from "../AnimatedNumber.svelte";
  import type { GraphNode, NodeKind } from "./power-graph";
  import { nodeGlow } from "./flow-pulse";
  import { motion } from "../motion/tier.svelte";

  let {
    node,
    soc,
    share = 0,
    onselect,
  }: {
    node: GraphNode;
    /** Battery or vehicle state of charge (0..100); draws the gauge and the figure when set. */
    soc?: number | undefined;
    /** This node's power as a share (0..1) of the remembered plant peak; the glow answers it. */
    share?: number;
    onselect?: ((id: string) => void) | undefined;
  } = $props();

  const ICONS: Record<NodeKind, Component<{ class?: string }>> = {
    pv: Sun,
    battery: BatteryCharging,
    load: House,
    generator: Fuel,
    grid: UtilityPole,
    charger: Car,
  };
  const Icon = $derived(ICONS[node.kind]);

  const active = $derived(node.flow !== "idle");
  /** No reading yet: the figure is a dash and the state line stays empty. */
  const unknown = $derived(node.value === undefined || !Number.isFinite(node.value));
  const hasSoc = $derived(soc !== undefined);
  // Arriving at the inverter points down the page's reading of "in", leaving points up.
  const FlowIcon = $derived(node.flow === "in" ? ArrowDown : node.flow === "out" ? ArrowUp : undefined);

  // Only `full` pays for the tile's glow and tint transitions: one 34 px blur per node.
  const boxTransition = $derived(motion.tier === "full" ? "transition-[box-shadow,border-color,background-color] duration-500" : "");
  const gaugeEase = $derived(motion.tier === "full" ? "transition:stroke-dashoffset 500ms linear" : "");

  const boxStyle = $derived.by(() => {
    const border = hasSoc ? "transparent" : active ? node.accent : "var(--border)";
    if (!active) return `border-color:${border};background-color:var(--card)`;
    return `border-color:${border};background-color:color-mix(in oklab, ${node.accent} 12%, var(--card));box-shadow:0 0 34px -6px ${nodeGlow(node.accent, share)}`;
  });

  // Gauge geometry: viewBox 56×56 scaled with the tile; the perimeter drives the dash fill.
  const INSET = 1.5;
  const SIZE = 56 - INSET * 2;
  const PERIMETER = SIZE * 4;
</script>

<div
  class={["absolute -translate-x-1/2 -translate-y-1/2", motion.tier === "full" && "transition-opacity duration-500", !active && "opacity-70"]}
  style="left:{node.at.x * 100}%;top:{node.at.y * 100}%"
>
  <button
    type="button"
    class="relative block size-14 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] sm:size-16"
    aria-label="{node.label}: Details"
    onclick={() => onselect?.(node.id)}
  >
    <span class="flex size-full flex-col items-center justify-center rounded-md border-2 leading-none {boxTransition}" style={boxStyle}>
      <span style:color={active ? node.accent : "var(--muted-foreground)"}>
        <Icon class={hasSoc ? "size-4" : "size-6 sm:size-7"} />
      </span>
      {#if soc !== undefined}
        <span class="mt-0.5 text-lg font-semibold tabular-nums sm:text-xl">{Math.round(soc)}<span class="text-[0.68em] font-medium">%</span></span>
      {/if}
    </span>
    {#if soc !== undefined}
      <svg class="absolute inset-0 size-full" viewBox="0 0 56 56" aria-hidden="true">
        <rect class="text-foreground/15" x={INSET} y={INSET} width={SIZE} height={SIZE} rx="1" fill="none" stroke="currentColor" stroke-width="2.5" />
        <rect
          x={INSET}
          y={INSET}
          width={SIZE}
          height={SIZE}
          rx="1"
          fill="none"
          stroke={node.accent}
          stroke-width="2.5"
          stroke-dasharray={PERIMETER}
          stroke-dashoffset={PERIMETER * (1 - Math.min(100, Math.max(0, soc)) / 100)}
          style={gaugeEase}
        />
      </svg>
    {/if}
  </button>
  <div
    class={[
      "pointer-events-none absolute left-1/2 flex w-24 -translate-x-1/2 flex-col items-center gap-0.5 leading-tight",
      node.labelSide === "above" ? "bottom-full mb-2 flex-col-reverse" : "top-full mt-2",
    ]}
  >
    <span class="max-w-full truncate text-xs font-medium text-muted-foreground">{node.label}</span>
    <span class="text-sm font-semibold whitespace-nowrap sm:text-base">
      <AnimatedNumber value={unknown ? null : Math.abs(node.value as number) / 1000} />
      <span class="text-xs font-normal text-muted-foreground">kW</span>
    </span>
    <span class="flex items-center gap-0.5 text-xs whitespace-nowrap" style:color={active ? node.accent : "var(--muted-foreground)"}>
      {#if FlowIcon}<FlowIcon class="size-3" />{/if}
      {unknown ? "\u00a0" : node.state}
    </span>
  </div>
</div>
