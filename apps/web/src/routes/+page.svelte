<script lang="ts">
  import { connect, http } from "../lib/api/core";
  import Dashboard from "../lib/live/Dashboard.svelte";
  import { sceneLayout } from "../lib/live/dashboard";
  import LocaleSwitch from "../lib/LocaleSwitch.svelte";
  import { m } from "../lib/paraglide/messages.js";
  import { getLocale } from "../lib/paraglide/runtime.js";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  let locale = $state(getLocale());

  const opening = sceneLayout(core);
</script>

<!-- Messages are no state: a new locale renders the screen anew. -->
{#key locale}
  {#await opening then layout}
    <Dashboard {core} {layout}>
      {#snippet nav()}
        <a href="#/builder">{m.nav_builder()}</a>
        <a href="#/settings">{m.nav_settings()}</a>
        <LocaleSwitch bind:locale />
      {/snippet}
    </Dashboard>
  {/await}
{/key}
