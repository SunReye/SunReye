<script lang="ts">
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import Builder from "../../lib/builder/Builder.svelte";
  import { loadPv, type Pv } from "../../lib/builder/pv";
  import { m } from "../../lib/paraglide/messages.js";

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  async function load(): Promise<Pv> {
    const response = await fetch(wasm);

    return loadPv(new Uint8Array(await response.arrayBuffer()));
  }
</script>

<header>
  <a href="#/">{m.nav_live()}</a>
</header>

<main>
  {#if webgl2}
    {#await load()}
      <p>{m.builder_loading()}</p>
    {:then pv}
      <Builder {pv} />
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
