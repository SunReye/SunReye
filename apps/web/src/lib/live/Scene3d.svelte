<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import type { SceneLayout } from "./dashboard.ts";

  let { core, layout }: { core: Core; layout: SceneLayout } = $props();

  /** three.js, the crate and what the scene needs: loaded only once it is shown. */
  async function load() {
    const [{ default: LiveScene }, { modelLoader }, pv, moduleTypes, capabilities] =
      await Promise.all([
        import("./LiveScene.svelte"),
        import("../cars/models.ts"),
        import("../builder/pv.ts").then(async ({ loadPv }) =>
          loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer())),
        ),
        core.moduleTypes(),
        core.capabilities(),
      ]);

    return {
      LiveScene,
      model: modelLoader(core),
      pv,
      moduleTypes: "problem" in moduleTypes ? [] : moduleTypes,
      capabilities: "problem" in capabilities ? undefined : capabilities,
    };
  }
</script>

<main>
  {#await load()}
    <p>{m.live_loading()}</p>
  {:then { LiveScene, model, pv, moduleTypes, capabilities }}
    <LiveScene {core} {pv} {layout} scene={layout.scene} {moduleTypes} {capabilities} {model} />
  {/await}
</main>
