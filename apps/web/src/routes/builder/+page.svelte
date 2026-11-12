<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import { Button } from "#lib/components/ui/button/index.js";
  import { connect, http } from "../../lib/api/core";
  import Builder from "../../lib/builder/Builder.svelte";
  import { emptyDraft } from "../../lib/builder/modules";
  import { loadPv } from "../../lib/builder/pv";
  import { m } from "../../lib/paraglide/messages.js";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The crate, the layout in force, the module types and the plant's location; without a layout,
   * an empty one. */
  async function load() {
    const [pv, layout, moduleTypes, devices, location] = await Promise.all([
      fetch(wasm).then(async (response) => loadPv(new Uint8Array(await response.arrayBuffer()))),
      core.layout(),
      core.moduleTypes(),
      core.devices(),
      core.location(),
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
      // Admin only, and unset before setup: the sun then stays put.
      location: "problem" in location ? undefined : location,
    };
  }
</script>

<main>
  {#if webgl2}
    {#await load()}
      <p class="p-6 text-sm text-muted-foreground">{m.builder_loading()}</p>
    {:then { pv, start, moduleTypes, devices, location }}
      <Builder {pv} {core} {start} {moduleTypes} {devices} {location} />
    {/await}
  {:else}
    <div class="flex flex-col items-start gap-3 p-6">
      <p>{m.builder_no_webgl()}</p>
      <Button variant="outline" href="#/">{m.builder_form()}</Button>
    </div>
  {/if}
</main>
