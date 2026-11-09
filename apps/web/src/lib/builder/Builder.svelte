<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import { m } from "../paraglide/messages.js";
  import { parseView, presetView, presets, type Preset, type View } from "./camera.ts";
  import { nextBlock } from "./draft.ts";
  import type { Pv, Scene } from "./pv.ts";
  import SceneCanvas from "./SceneCanvas.svelte";
  import SceneForm from "./SceneForm.svelte";

  let { pv }: { pv: Pv } = $props();

  /** Where each browser keeps its last view (ADR 20). */
  const KEPT = "sunreye.builder.view";

  const labels: Readonly<Record<Preset, () => string>> = {
    north: m.view_north,
    east: m.view_east,
    south: m.view_south,
    west: m.view_west,
    top: m.view_top,
    isometric: m.view_isometric,
  };

  // Desktop and tablet edit; a phone views (ADR 20).
  const phone = new MediaQuery("max-width: 40rem");

  let scene = $state.raw<Scene>({ north: 0, blocks: [nextBlock([])], obstacles: [] });
  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  const geometry = $derived(pv.geometry(scene));

  function keep(view: View): void {
    kept = view;
    localStorage.setItem(KEPT, JSON.stringify(view));
  }
</script>

<section class="stage">
  <SceneCanvas {geometry} view={kept ?? presetView("isometric", geometry)} onview={keep} />
  <nav aria-label={m.builder_views()}>
    {#each presets as preset (preset)}
      <button
        type="button"
        onclick={() => {
          keep(presetView(preset, geometry));
        }}>{labels[preset]()}</button
      >
    {/each}
  </nav>
</section>
{#if phone.current}
  <p>{m.builder_view_only()}</p>
{:else}
  <SceneForm bind:scene />
{/if}

<style>
  .stage {
    display: grid;
    grid-template-rows: minmax(20rem, 70vh) auto;
    gap: 0.5rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
