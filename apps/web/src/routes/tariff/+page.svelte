<script lang="ts">
  import { connect, http } from "../../lib/api/core";
  import { m } from "../../lib/paraglide/messages.js";
  import TariffScreen from "../../lib/tariff/TariffScreen.svelte";
  import { routeGo, routeParams } from "../../lib/range/kit-route.ts";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  // The range lives in the hash route (ADR 21).
  const params = $derived(routeParams());
</script>

<header>
  <a href="#/">{m.nav_live()}</a>
</header>
<TariffScreen {core} {params} go={routeGo} />
