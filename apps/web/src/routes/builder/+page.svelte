<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import { Button } from "#lib/components/ui/button/index.js";
  import Builder from "../../lib/builder/Builder.svelte";
  import { limitsOf } from "../../lib/builder/checks";
  import { emptyDraft } from "../../lib/builder/modules";
  import { loadPv } from "../../lib/builder/pv";
  import { m } from "../../lib/paraglide/messages.js";

  const core = useCore();

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The crate, the layout in force, the module types, the plant's location and the inverters'
   * voltage limits; without a layout, an empty one. */
  async function load() {
    const [pv, layout, moduleTypes, devices, location, capabilities] = await Promise.all([
      fetch(wasm).then(async (response) => loadPv(new Uint8Array(await response.arrayBuffer()))),
      core.layout(),
      core.moduleTypes(),
      core.devices(),
      core.location(),
      core.capabilities(),
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
      limits: "problem" in capabilities ? {} : limitsOf(capabilities),
    };
  }
</script>

<main>
  {#if webgl2}
    {#await load()}
      <p class="p-6 text-sm text-muted-foreground">{m.builder_loading()}</p>
    {:then { pv, start, moduleTypes, devices, location, limits }}
      <Builder {pv} {core} {start} {moduleTypes} {devices} {location} {limits} />
    {/await}
  {:else}
    <div class="flex flex-col items-start gap-3 p-6">
      <p>{m.builder_no_webgl()}</p>
      <Button variant="outline" href="#/">{m.builder_form()}</Button>
    </div>
  {/if}
</main>
