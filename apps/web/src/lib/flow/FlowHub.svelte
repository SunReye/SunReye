<!--
  The 2D flow's hub, the inverter (ADR 21): its DC input, efficiency and own draw on a pill above,
  so rails pass underneath, and a ring that beats with the plant on `full`. Tapping opens its sheet.
-->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import Cpu from "@lucide/svelte/icons/cpu";
  import Gauge from "@lucide/svelte/icons/gauge";
  import AnimatedNumber from "../components/animated-number.svelte";
  import PowerNumber from "../components/power-number.svelte";
  import type { MotionTier } from "../motion/tier.ts";
  import { m } from "../paraglide/messages.js";
  import type { Hub } from "./reading.ts";
  import type { Pt } from "./schematic.ts";

  let {
    at,
    hub,
    plantLevel,
    tier,
    pill,
    onselect,
  }: {
    at: Pt;
    hub: Hub;
    /** How hard the plant works, 0..1. */
    plantLevel: number;
    tier: MotionTier;
    /** Whether the box is tall enough for the pill. */
    pill: boolean;
    onselect: (id: string) => void;
  } = $props();
</script>

<!-- The inverter hub. Its metric pill floats above on a translucent backdrop so rails pass underneath. -->
<div
  class="absolute -translate-x-1/2 -translate-y-1/2"
  style="left:{at.x * 100}%;top:{at.y * 100}%"
>
  {#if hub.dc !== undefined && pill}
    <dl
      class="absolute bottom-full left-1/2 mb-2.5 flex -translate-x-1/2 gap-4 rounded-md border border-border/60 bg-background/85 px-3 py-1.5 leading-tight whitespace-nowrap backdrop-blur-[2px]"
    >
      <div class="flex flex-col items-center">
        <dd class="text-sm font-semibold text-solar">
          <PowerNumber watts={hub.dc} unitClass="text-xs font-normal text-muted-foreground" />
        </dd>
        <dt class="text-xs text-muted-foreground">{m.flow_dc()}</dt>
      </div>
      {#if hub.efficiency !== undefined && hub.efficiency > 0}
        <div class="flex flex-col items-center">
          <dd class="flex items-center gap-1 text-sm font-semibold">
            <Gauge class="size-3 text-muted-foreground" /><AnimatedNumber value={hub.efficiency} />
            <span class="text-xs font-normal text-muted-foreground">%</span>
          </dd>
          <dt class="text-xs text-muted-foreground">{m.rd_efficiency()}</dt>
        </div>
      {/if}
      {#if hub.own !== undefined}
        <div class="flex flex-col items-center max-sm:hidden">
          <dd class="text-sm font-medium">
            <PowerNumber watts={hub.own} unitClass="text-xs font-normal text-muted-foreground" />
          </dd>
          <dt class="text-xs text-muted-foreground">{m.rd_own_use()}</dt>
        </div>
      {/if}
    </dl>
  {/if}
  <Pressable
    class="relative flex size-14 items-center justify-center rounded-md border-2 border-foreground/70 bg-card active:scale-[0.97] sm:size-16"
    aria-label={m.flow_details({ name: m.detail_inverter() })}
    onclick={() => {
      onselect("inverter");
    }}
  >
    <span
      class={[
        "hub-ring absolute -inset-1 rounded-md border border-foreground/40",
        tier !== "full" && "hub-still",
      ]}
      style="--plant-level:{plantLevel}"
    ></span>
    <Cpu class="size-6 sm:size-7" />
  </Pressable>
</div>

<style>
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
  }
</style>
