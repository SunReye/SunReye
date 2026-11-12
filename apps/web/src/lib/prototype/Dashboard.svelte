<!--
  PROTOTYPE: the dashboard (ADR 21): master's two-column layout. Landscape never scrolls: the hero
  takes the left ~53 %, the right column answers "now" and "today". On a phone the same blocks stack,
  hero first.
-->
<script lang="ts">
  import type { LiveSim } from "./sim.svelte";
  import type { Screen } from "./nav";
  import Hero from "./Hero.svelte";
  import NowStrip from "./NowStrip.svelte";
  import TodayPanel from "./TodayPanel.svelte";
  import EvCard from "./EvCard.svelte";

  let {
    sim,
    dark,
    tod,
    onopen,
    onnavigate,
  }: { sim: LiveSim; dark: boolean; tod: string; onopen: (id: string) => void; onnavigate: (id: Screen) => void } = $props();
</script>

<div class="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 pt-3 lg:grid lg:h-dvh lg:min-h-[640px] lg:grid-cols-[minmax(0,53fr)_minmax(0,47fr)] lg:gap-6 lg:py-6 lg:pr-6 lg:pl-0">
  <Hero {sim} {dark} {tod} onselect={onopen} {onnavigate} class="h-[68dvh] min-h-[480px] min-w-0 overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1 lg:h-auto lg:min-h-0" />

  <div class="flex min-h-0 min-w-0 flex-col gap-3">
    <NowStrip {sim} {onopen} />
    <TodayPanel {sim} {onopen} />
    {#if sim.has.ev}<EvCard {sim} {onopen} />{/if}
  </div>
</div>
