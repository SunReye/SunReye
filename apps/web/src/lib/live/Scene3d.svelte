<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import type { Core } from "../api/core.ts";
  import SceneCredits from "../scene/SceneCredits.svelte";
  import type { SceneFailure } from "../scene/stage.svelte.ts";
  import { warm } from "../scene/warm.ts";
  import { LiveAround } from "./around.svelte.ts";
  import type { SceneLayout } from "./dashboard.ts";
  import { LiveSky } from "./sky.svelte.ts";

  let {
    core,
    layout,
    locked,
    top,
    onselect,
    onready,
    onerror,
  }: {
    core: Core;
    layout: SceneLayout;
    locked: boolean;
    /** Pixels at the top the chips leave free. */
    top: number;
    onselect: (id: string) => void;
    /** The first frame is on screen and the scene has started to fade in. */
    onready: () => void;
    onerror: (reason: SceneFailure) => void;
  } = $props();

  /** The weather now lights the scene (ADR 20). */
  const sky = new LiveSky(() => core);

  /** The layout's imported surroundings: they come once the house is drawn (ADR 20). */
  const surroundings = new LiveAround(() => ({ core, scene: layout.scene }));

  /** three.js, the crate, the worker's textures and what the scene needs: loaded once mounted.
   * Null when any of it failed, which the hero is told. */
  async function load() {
    try {
      return await loaded();
    } catch {
      onerror("failed");

      return null;
    }
  }

  async function loaded() {
    const [{ default: LiveScene }, { modelLoader }, pv, moduleTypes, capabilities, location] =
      await Promise.all([
        import("./LiveScene.svelte"),
        import("../cars/models.ts"),
        import("../builder/pv.ts").then(async ({ loadPv }) =>
          loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer())),
        ),
        core.moduleTypes(),
        core.capabilities(),
        // The admin's (ADR 9): for a viewer the sun stays put.
        core.location().catch(() => null),
        warm().textures,
      ]);

    surroundings.use(pv);

    return {
      LiveScene,
      model: modelLoader(core),
      pv,
      moduleTypes: "problem" in moduleTypes ? [] : moduleTypes,
      capabilities: "problem" in capabilities ? undefined : capabilities,
      location: location === null || "problem" in location ? undefined : location,
    };
  }
</script>

<!-- Fills the hero, which sizes it; the hero shows what is underneath until the scene fades in. -->
<div class="relative size-full">
  {#await load() then scene}
    {#if scene !== null}
      {@const { LiveScene, model, pv, moduleTypes, capabilities, location } = scene}
      <LiveScene
        {core}
        {pv}
        {layout}
        scene={layout.scene}
        {moduleTypes}
        {capabilities}
        {model}
        {location}
        diffuse={sky.diffuse}
        around={surroundings.stood}
        {locked}
        {top}
        {onselect}
        {onready}
        {onerror}
      />
    {/if}
  {/await}
  <!-- On the canvas's lower edge while they are drawn. -->
  <div class="pointer-events-none absolute inset-x-3 bottom-1 flex">
    <SceneCredits credits={surroundings.stood?.around.credits ?? []} />
  </div>
</div>
