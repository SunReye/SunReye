<!-- PROTOTYPE: the hero: 3D scene or 2D flow, toggle in its corner (ADR 21). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import Scene3d from "./Scene3d.svelte";
  import Flow2d from "./Flow2d.svelte";
  import type { LiveSim } from "./sim.svelte";
  import { haptics } from "./haptics";

  let {
    sim,
    dark,
    tod,
    onselect,
    framing = "hero",
    presets = "left",
    overlay,
    class: className = "",
  }: {
    sim: LiveSim;
    dark: boolean;
    tod: string;
    onselect?: (id: string) => void;
    framing?: "hero" | "wide";
    presets?: "left" | "right";
    overlay?: Snippet;
    class?: string;
  } = $props();

  let mode = $state<"3d" | "2d">((typeof localStorage !== "undefined" && (localStorage.getItem("proto.hero") as "3d" | "2d")) || "3d");

  function set(m: string): void {
    if (!m || m === mode) return;
    mode = m as "3d" | "2d";
    localStorage.setItem("proto.hero", m);
    haptics.selection();
  }
</script>

<section class="relative isolate {className}" aria-label="Anlage live">
  {#if mode === "3d"}
    <Scene3d {sim} {dark} {tod} {onselect} {framing} {presets} />
  {:else}
    <Flow2d {sim} />
  {/if}
  {@render overlay?.()}
  <ToggleGroup.Root
    type="single"
    size="sm"
    spacing={1}
    bind:value={() => mode, set}
    class="glass-ambient absolute top-3 right-3 z-10 rounded-md p-0.5 ring-1 ring-border/60 elevation-1"
    aria-label="Ansicht"
  >
    <ToggleGroup.Item value="3d" class="px-3 text-xs">3D</ToggleGroup.Item>
    <ToggleGroup.Item value="2d" class="px-3 text-xs">2D</ToggleGroup.Item>
  </ToggleGroup.Root>
</section>
