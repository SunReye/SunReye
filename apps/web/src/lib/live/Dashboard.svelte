<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Core } from "../api/core.ts";
  import LiveScreen from "../LiveScreen.svelte";
  import { CHOICE, LOW_POWER, dashboard, keptChoice, type SceneLayout } from "./dashboard.ts";
  import Scene3d from "./Scene3d.svelte";
  import ViewSwitch from "./ViewSwitch.svelte";

  let {
    core,
    layout,
    nav,
  }: {
    core: Core;
    /** The layout in force when it has a scene. */
    layout: SceneLayout | null;
    nav: Snippet;
  } = $props();

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  let choice = $state(keptChoice(localStorage.getItem(CHOICE)));

  let lowPower = $state(localStorage.getItem(LOW_POWER) === "on");

  const shown = $derived(dashboard({ scene: layout !== null, webgl2, lowPower, choice }));
</script>

<header>
  {@render nav()}
  <ViewSwitch shows={shown.shows} toggles={shown.toggles} bind:choice bind:lowPower />
</header>
{#if shown.shows === "3d" && layout !== null}
  <Scene3d {core} {layout} />
{:else}
  <LiveScreen {core} />
{/if}
