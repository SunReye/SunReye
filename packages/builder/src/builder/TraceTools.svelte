<!--
  The tracing bar's tools for what is held (ADR 20): a held ready shape and letting go; else the
  picked line's; else the roof's heights and the ready shapes.
-->
<script lang="ts">
  import HeldReady from "./HeldReady.svelte";
  import PickedLine from "./PickedLine.svelte";
  import ReadyMenu from "./ReadyMenu.svelte";
  import RoofHeights from "./RoofHeights.svelte";
  import type { TracingMode } from "./tracing-mode.svelte.ts";

  let { mode }: { mode: TracingMode } = $props();

  const picked = $derived(mode.picked);
</script>

{#if mode.placing}
  <HeldReady {mode} placing={mode.placing} />
{:else if picked}
  <PickedLine {mode} {picked} />
{:else}
  <RoofHeights {mode} />
  <ReadyMenu {mode} faces={mode.block !== undefined} />
{/if}
