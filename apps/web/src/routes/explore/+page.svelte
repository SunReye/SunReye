<script lang="ts">
  import { access } from "../../lib/shell/access.svelte.ts";
  import { useCore } from "../../lib/shell/core.ts";
  import ExploreScreen from "../../lib/explore/ExploreScreen.svelte";
  import { routeBack, routeGo, routeParams } from "../../lib/range/kit-route.ts";

  const core = useCore();

  const shell = access();

  // The whole view lives in the hash route (ADR 22).
  const params = $derived(routeParams());
</script>

<ExploreScreen {core} admin={shell?.admin ?? false} {params} go={routeGo} back={routeBack} />
