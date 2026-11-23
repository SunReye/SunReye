<!--
  One node of the 2D flow. Ported from v3 (dev 780b4e2, power-flow-node.svelte) and restyled:
  a boxy tile in the node's energy colour, the SOC as the tile's content with a square gauge traced
  inside it, and a caption stack that names the node, its power and its direction. Tapping opens
  the node's detail sheet.
-->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import { KIND_ICONS } from "../equipment-kinds.ts";
  import PowerNumber from "../components/power-number.svelte";
  import type { MotionTier } from "@sunreye/builder/motion";
  import { m } from "../paraglide/messages.js";
  import { nodeGlow } from "./flow-pulse.ts";
  import { ARROWS, nodeLabel, STATES } from "./node-words.ts";
  import type { GraphNode } from "./schematic.ts";

  let {
    node,
    soc,
    share = 0,
    tier,
    onselect,
  }: {
    node: GraphNode;
    /** Battery or vehicle state of charge (0..100); draws the gauge and the figure when set. */
    soc?: number | undefined;
    /** This node's power as a share (0..1) of the remembered plant peak; the glow answers it. */
    share?: number;
    tier: MotionTier;
    onselect: (id: string) => void;
  } = $props();

  const label = $derived(nodeLabel(node));

  const Icon = $derived(KIND_ICONS[node.kind]);

  const active = $derived(node.flow !== "idle");

  /** No reading yet: the figure is a dash and the state line stays empty. */
  const watts = $derived(
    node.value === undefined || !Number.isFinite(node.value) ? null : node.value,
  );

  const hasSoc = $derived(soc !== undefined);

  // Arriving at the inverter points down the page's reading of "in", leaving points up.
  const FlowIcon = $derived(ARROWS[node.flow]);

  // Only `full` pays for the tile's glow and tint transitions: one 34 px blur per node.
  const boxTransition = $derived(
    tier === "full"
      ? "transition-[box-shadow,border-color,background-color] duration-(--motion-flow-tile)"
      : "",
  );

  const gaugeEase = $derived(
    tier === "full" ? "transition:stroke-dashoffset var(--motion-flow-tile) linear" : "",
  );

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
  class={[
    "absolute -translate-x-1/2 -translate-y-1/2",
    tier === "full" && "transition-opacity duration-(--motion-flow-tile)",
    !active && "opacity-70",
  ]}
  style="left:{node.at.x * 100}%;top:{node.at.y * 100}%"
>
  <Pressable
    class="relative block size-14 rounded-md motion-safe:active:scale-(--press-scale-calm) sm:size-16"
    aria-label={m.flow_details({ name: label })}
    onclick={() => {
      onselect(node.id);
    }}
  >
    <span
      class="flex size-full flex-col items-center justify-center rounded-md border-2 leading-none {boxTransition}"
      style={boxStyle}
    >
      <span style:color={active ? node.accent : "var(--muted-foreground)"}>
        <Icon class={hasSoc ? "size-4" : "size-6 sm:size-7"} />
      </span>
      {#if soc !== undefined}
        <span class="mt-0.5 text-lg font-semibold tabular-nums sm:text-xl"
          >{Math.round(soc)}<span class="text-[0.68em] font-medium">%</span></span
        >
      {/if}
    </span>
    {#if soc !== undefined}
      <svg class="absolute inset-0 size-full" viewBox="0 0 56 56" aria-hidden="true">
        <rect
          class="text-foreground/15"
          x={INSET}
          y={INSET}
          width={SIZE}
          height={SIZE}
          rx="1"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        />
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
  </Pressable>
  <div
    class={[
      "pointer-events-none absolute left-1/2 flex w-24 -translate-x-1/2 flex-col items-center gap-0.5 leading-tight",
      node.labelSide === "above" ? "bottom-full mb-2 flex-col-reverse" : "top-full mt-2",
    ]}
  >
    <span class="max-w-full truncate text-xs font-medium text-muted-foreground">{label}</span>
    <span class="text-sm font-semibold whitespace-nowrap sm:text-base">
      {#if node.estimated}<span
          class="me-0.5 font-normal text-muted-foreground"
          title={m.detail_estimated()}
          aria-label={m.detail_estimated()}>≈</span
        >{/if}<PowerNumber
        watts={watts === null ? null : Math.abs(watts)}
        unitClass="text-xs font-normal text-muted-foreground"
      />
    </span>
    <span
      class="flex items-center gap-0.5 text-xs whitespace-nowrap"
      style:color={active ? node.accent : "var(--muted-foreground)"}
    >
      {#if FlowIcon}<FlowIcon class="size-3" />{/if}
      {watts === null ? "\u00a0" : STATES[node.state]()}
    </span>
  </div>
</div>
