<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import type { Core, Device } from "../api/core.ts";
  import { emptyDraft } from "../builder/modules";
  import { loadPv } from "../builder/pv";
  import { m } from "../paraglide/messages.js";

  let { core, devices, ondone }: { core: Core; devices: readonly Device[]; ondone: () => void } =
    $props();

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The builder, its crate and the module types; the first run starts from an empty layout. */
  async function load() {
    const [{ default: Builder }, pv, moduleTypes] = await Promise.all([
      // Lazy, so three.js loads up front only on the builder route (ADR 20).
      import("../builder/Builder.svelte"),
      fetch(wasm).then(async (response) => loadPv(new Uint8Array(await response.arrayBuffer()))),
      core.moduleTypes(),
    ]);

    return { Builder, pv, moduleTypes: "problem" in moduleTypes ? [] : moduleTypes };
  }
</script>

{#if webgl2}
  {#await load()}
    <p>{m.builder_loading()}</p>
  {:then { Builder, pv, moduleTypes }}
    <div class="builder">
      <Builder {pv} {core} start={emptyDraft()} {moduleTypes} {devices} />
    </div>
  {/await}
{:else}
  <p>{m.builder_no_webgl()}</p>
{/if}
<button type="button" onclick={ondone}>{m.setup_finish()}</button>

<style>
  .builder {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(20rem, 2fr);
    align-items: start;
    gap: 1rem;
  }

  @media (max-width: 40rem) {
    .builder {
      grid-template-columns: 1fr;
    }
  }
</style>
