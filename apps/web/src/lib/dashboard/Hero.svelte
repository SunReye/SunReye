<!--
  The hero: the 3D scene or the 2D flow with no glass behind either, the toggle in its corner and
  the headline (ADR 11, 21).
-->
<script lang="ts">
  import type { Core, Live } from "../api/core.ts";
  import { CHOICE, dashboard, keptChoice, type SceneLayout } from "../live/dashboard.ts";
  import Flow2d from "../flow/Flow2d.svelte";
  import Scene3d from "../live/Scene3d.svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import Headline from "./Headline.svelte";
  import ViewToggle from "./ViewToggle.svelte";

  let {
    core,
    layout,
    admin,
    live,
    plant,
    plantStale,
    onselect,
    class: className = "",
  }: {
    core: Core;
    layout: SceneLayout | null;
    /** Whether the builder is offered without a scene. */
    admin: boolean;
    /** Undefined until the stream first answers. */
    live: Live | undefined;
    /** The `plant` device's values (ADR 14). */
    plant: Readonly<Record<string, number>> | undefined;
    /** When each of its stale values was last read. */
    plantStale: Readonly<Record<string, number>> | undefined;
    onselect: (id: string) => void;
    class?: string;
  } = $props();

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  let choice = $state(keptChoice(localStorage.getItem(CHOICE)));

  // The tier store holds the low-power switch, so a flip in Settings shows at once.
  const shown = $derived(
    dashboard({ scene: layout !== null, webgl2, lowPower: motion.lowPower, choice }),
  );

  const scene = $derived(shown.shows === "3d" ? layout : null);

  let height = $state(0);
</script>

<section class="relative isolate {className}" aria-label={m.dash_hero()}>
  {#if scene === null}
    <Flow2d {core} {live} top={height + 12} {onselect} />
  {:else}
    <div class="absolute inset-0">
      <Scene3d {core} layout={scene} />
    </div>
  {/if}

  <Headline {live} {plant} {plantStale} figures={scene !== null} {onselect} bind:height />

  <ViewToggle
    shows={shown.shows}
    toggles={shown.toggles}
    build={layout === null && admin}
    onchoose={(view) => {
      choice = view;
      localStorage.setItem(CHOICE, view);
    }}
  />
</section>
