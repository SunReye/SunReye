<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { drillRoute } from "../../lib/components/drill-in/route.ts";
  import Controls from "../../lib/controls/Controls.svelte";

  const core = useCore();

  /** The open group as `?group=` on the hash route: back returns to the root (ADR 21). */
  const route = drillRoute({ page, goto });
</script>

<Controls {core} open={route.open} onnavigate={route.navigate} />
<Toaster position="top-center" />
