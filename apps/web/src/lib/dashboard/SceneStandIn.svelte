<!--
  What the hero shows while the 3D scene loads behind it (ADR 20 Loading): the scene's own studio
  backdrop, the page colour, so the fade-in changes nothing but the house, and a quiet shadow where the house will
  stand. No spinner: a line of text appears only once loading takes longer than a second. Not the
  2D flow: a diagram swapped away unasked would be read, tapped, and then move.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";

  let { slow = false }: { slow?: boolean } = $props();
</script>

<div class="bg-background absolute inset-0 overflow-hidden" aria-hidden={!slow}>
  <div class="ground absolute top-[47%] left-[8%] h-[38%] w-[84%]"></div>
  <p
    class={[
      "absolute bottom-4 left-4 text-xs text-muted-foreground transition-opacity duration-(--motion-base)",
      slow ? "opacity-100" : "opacity-0",
    ]}
    role="status"
  >
    {#if slow}{m.dash_scene_loading()}{/if}
  </p>
</div>

<style>
  /* Where the plot will lie: barely there, so nothing seems missing and nothing jumps. */
  .ground {
    background: radial-gradient(closest-side, rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.04) 55%, transparent);
  }
</style>
