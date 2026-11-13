<!--
  A part of a screen that fills in a frame of its own (ADR 21): the screen mounts its frame and the
  skeletons in the first frame, then each staged part, in order, one per frame after that.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { stage } from "./frames.ts";

  let { children, skeleton }: { children: Snippet; skeleton?: Snippet } = $props();

  let ready = $state(false);

  $effect(() =>
    stage(() => {
      ready = true;
    }),
  );
</script>

{#if ready}{@render children()}{:else}{@render skeleton?.()}{/if}
