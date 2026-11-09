<script lang="ts">
  import { connect, http } from "../../lib/api/core";
  import { m } from "../../lib/paraglide/messages.js";
  import TariffScreen from "../../lib/tariff/TariffScreen.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));
</script>

<header>
  <a href="#/">{m.nav_live()}</a>
</header>
<TariffScreen {core} />
