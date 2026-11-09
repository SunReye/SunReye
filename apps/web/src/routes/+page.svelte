<script lang="ts">
  import { connect, http } from "../lib/api/core";
  import Home from "../lib/live/Home.svelte";
  import { entry } from "../lib/setup/entry";
  import SignIn from "../lib/setup/SignIn.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  let opening = $state.raw(entry(core));

  function reopen(): void {
    opening = entry(core);
  }

  /** Lazy: the dashboard loads only what it shows, and setup reaches the builder (ADR 11). */
  async function setup() {
    return (await import("../lib/setup/Setup.svelte")).default;
  }
</script>

{#await opening then shown}
  {#if shown.screen === "sign-in"}
    <SignIn {core} onsignedin={reopen} />
  {:else if shown.screen === "setup"}
    {#await setup() then Setup}
      <Setup {core} signedIn={shown.signedIn} onfinish={reopen} />
    {/await}
  {:else}
    <Home {core} layout={shown.layout} />
  {/if}
{/await}
