<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import ForecastScreen from "../../lib/forecast/ForecastScreen.svelte";
  import { routeGo, routeParams } from "../../lib/range/kit-route.ts";

  const core = useCore();

  // The range lives in the hash route (ADR 21).
  const params = $derived(routeParams());
</script>

<ForecastScreen {core} {params} go={routeGo} />
