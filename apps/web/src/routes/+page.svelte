<script lang="ts">
  import { connect, http } from "../lib/api/core";
  import LiveScreen from "../lib/LiveScreen.svelte";
  import LocaleSwitch from "../lib/LocaleSwitch.svelte";
  import { m } from "../lib/paraglide/messages.js";
  import { getLocale } from "../lib/paraglide/runtime.js";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  let locale = $state(getLocale());
</script>

<!-- Messages are no state: a new locale renders the screen anew. -->
{#key locale}
  <header>
    <a href="#/builder">{m.nav_builder()}</a>
    <LocaleSwitch bind:locale />
  </header>
  <LiveScreen {core} />
{/key}
