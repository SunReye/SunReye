<!--
  The hero: the 3D scene or the 2D flow with no glass behind either, the toggle in its corner and
  the headline (ADR 11, 21). The dashboard never waits for the scene (ADR 20 Loading): it loads
  once the page is idle, behind the studio stand-in or the flow it replaces, and fades in.
-->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import type { Core, Live } from "../api/core.ts";
  import { CHOICE, dashboard, keptChoice, type SceneLayout } from "../live/dashboard.ts";
  import Flow2d from "../flow/Flow2d.svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import Headline from "./Headline.svelte";
  import HeroScene from "./HeroScene.svelte";
  import { SceneLoad } from "./scene-load.svelte.ts";
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

  const load = new SceneLoad();

  let choice = $state(keptChoice(localStorage.getItem(CHOICE)));

  // The tier store holds the low-power switch, so a flip in Settings shows at once.
  const shown = $derived(
    dashboard({ scene: layout !== null, webgl2: load.webgl2, lowPower: motion.lowPower, choice }),
  );

  const scene = $derived(shown.shows === "3d" ? layout : null);

  load.follow(() => scene !== null);

  const failed = $derived(scene !== null && load.stage === "failed");
  const flowShown = $derived(scene === null || failed || load.under === "flow");
  const mode = $derived(scene !== null && !failed ? "3d" : "2d");

  let height = $state(0);
</script>

<section class="relative isolate {className}" aria-label={m.dash_hero()}>
  {#if flowShown}
    <Flow2d {core} {live} top={height + 12} {onselect} />
  {/if}
  {#if mode === "3d" && scene !== null}
    <HeroScene {core} layout={scene} {load} {onselect} />
  {/if}

  <Headline {live} {plant} {plantStale} figures={!flowShown} {onselect} bind:height>
    {#if failed}
      <!-- Quiet, beside the figure it does not change: the flow below is the dashboard. -->
      <span
        class="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
        role="status"
      >
        {m.dash_scene_failed()}
        <Pressable
          class="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => {
            load.retry();
          }}>{m.dash_scene_retry()}</Pressable
        >
      </span>
    {/if}
  </Headline>

  <ViewToggle
    shows={mode}
    toggles={shown.toggles}
    build={layout === null && admin}
    onchoose={(view) => {
      // The wish is still 3D after a failed load: asking again retries.
      if (view === "3d" && failed) load.retry();
      else {
        choice = view;
        localStorage.setItem(CHOICE, view);
      }
    }}
  />
</section>
