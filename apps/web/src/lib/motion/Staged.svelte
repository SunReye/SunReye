<!--
  A part of a screen that fills after the screen mounts (ADR 21): the screen mounts its frame and the
  skeletons in the first frame, then the staged parts, in order, as many a frame as fit its slice.
-->
<script lang="ts">
  import { flushSync, type Snippet } from "svelte";
  import { stage } from "./frames.ts";

  let { children, skeleton }: { children: Snippet; skeleton?: Snippet } = $props();

  let ready = $state(false);

  $effect(() =>
    stage(() => {
      ready = true;
      // Built now, so the frame's slice counts what it cost.
      flushSync();
    }),
  );
</script>

{#if ready}{@render children()}{:else}{@render skeleton?.()}{/if}
