<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { connect, http } from "../../lib/api/core";
  import { drillRoute } from "../../lib/components/drill-in/route.ts";
  import Controls from "../../lib/controls/Controls.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  /** The open group as `?group=` on the hash route: back returns to the root (ADR 21). */
  const route = drillRoute({ page, goto });
</script>

<Controls {core} open={route.open} onnavigate={route.navigate} />
<Toaster position="top-center" />
