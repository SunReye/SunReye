<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import TariffScreen from "../../lib/tariff/TariffScreen.svelte";
  import { routeGo, routeParams } from "../../lib/range/kit-route.ts";

  const core = useCore();

  // The range lives in the hash route (ADR 21).
  const params = $derived(routeParams());
</script>

<TariffScreen {core} {params} go={routeGo} />
