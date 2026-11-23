<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import { Button } from "@sunreye/ui/button";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import Builder, { BUILDER_SIZE } from "../../lib/builder/Builder.svelte";
  import { inputsOf, limitsOf } from "../../lib/builder/checks";
  import { emptyDraft } from "../../lib/builder/modules";
  import { loadPv } from "../../lib/builder/pv";
  import { typesOf } from "../../lib/api/layout-change";
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
      types: "problem" in layout ? undefined : typesOf(layout),
      moduleTypes: "problem" in moduleTypes ? [] : moduleTypes,
      // A viewer lists no devices; they view and place nothing.
      devices: "problem" in devices ? [] : devices,
      // Admin only, and unset before setup: the sun then stays put.
      location: "problem" in location ? undefined : location,
      limits: "problem" in capabilities ? {} : limitsOf(capabilities),
      inputs: "problem" in capabilities ? {} : inputsOf(capabilities),
    };
  }
</script>

<main>
  {#if webgl2}
    {#await load()}
      <Skeleton
        class={["rounded-none", BUILDER_SIZE]}
        role="status"
        aria-label={m.builder_loading()}
      />
    {:then { pv, start, types, moduleTypes, devices, location, limits, inputs }}
      <Builder {pv} {core} {start} {types} {moduleTypes} {devices} {location} {limits} {inputs} />
    {/await}
  {:else}
    <div class="flex flex-col items-start gap-3 p-6">
      <p>{m.builder_no_webgl()}</p>
      <Button variant="outline" href="#/">{m.builder_form()}</Button>
    </div>
  {/if}
</main>
