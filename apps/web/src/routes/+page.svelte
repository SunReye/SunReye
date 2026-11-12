<script lang="ts">
  import { connect, http } from "../lib/api/core";
  import Home from "../lib/live/Home.svelte";
  import { entry, type Entry } from "../lib/setup/entry";
  import { access } from "../lib/shell/access.svelte.ts";
  import SignIn from "../lib/setup/SignIn.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const shell = access();

  /** The entry, with the shell told whether to frame it and whether Controls is listed. */
  async function open(): Promise<Entry> {
    if (shell) shell.bare = true;

    const shown = await entry(core);

    if (shell && shown.screen === "dashboard") {
      shell.admin = shown.admin;
      shell.bare = false;
    }

    return shown;
  }

  let opening = $state.raw(open());

  function reopen(): void {
    opening = open();
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
