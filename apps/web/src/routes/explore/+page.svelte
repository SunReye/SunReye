<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import ExploreScreen from "../../lib/explore/ExploreScreen.svelte";
  import { routeGo, routeParams } from "../../lib/range/kit-route.ts";

  const core = useCore();

  // The whole view lives in the hash route (ADR 22).
  const params = $derived(routeParams());
</script>

<ExploreScreen {core} {params} go={routeGo} />
