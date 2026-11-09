<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import { connect, http } from "../../lib/api/core";
  import Builder from "../../lib/builder/Builder.svelte";
  import { emptyDraft } from "../../lib/builder/modules";
  import { loadPv } from "../../lib/builder/pv";
  import { m } from "../../lib/paraglide/messages.js";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The crate, the layout in force and the module types; without a layout, an empty one. */
  async function load() {
    const [pv, layout, moduleTypes, devices] = await Promise.all([
      fetch(wasm).then(async (response) => loadPv(new Uint8Array(await response.arrayBuffer()))),
      core.layout(),
      core.moduleTypes(),
      core.devices(),
    ]);

    const empty = emptyDraft();

    return {
      pv,
      start:
        "problem" in layout
          ? empty
          : { scene: layout.scene ?? empty.scene, strings: layout.strings },
      moduleTypes: "problem" in moduleTypes ? [] : moduleTypes,
      // A viewer lists no devices; they view and place nothing.
      devices: "problem" in devices ? [] : devices,
    };
  }
</script>

<header>
  <a href="#/">{m.nav_live()}</a>
</header>

<main>
  {#if webgl2}
    {#await load()}
      <p>{m.builder_loading()}</p>
    {:then { pv, start, moduleTypes, devices }}
      <Builder {pv} {core} {start} {moduleTypes} {devices} />
    {/await}
  {:else}
    <p>{m.builder_no_webgl()}</p>
    <p><a href="#/">{m.builder_form()}</a></p>
  {/if}
</main>

<style>
  main {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(20rem, 2fr);
    align-items: start;
    gap: 1rem;
  }

  @media (max-width: 40rem) {
    main {
      grid-template-columns: 1fr;
    }
  }
</style>
