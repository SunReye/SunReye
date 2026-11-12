<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { connect, http } from "../../lib/api/core";
  import { drillRoute } from "../../lib/components/drill-in/route.ts";
  import SettingsScreen from "../../lib/settings/SettingsScreen.svelte";
  import { access } from "../../lib/shell/access.svelte.ts";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const shell = access();

  /** The open group as `?group=` on the hash route: back returns to the root (ADR 21). */
  const route = drillRoute({ page, goto });
</script>

<SettingsScreen
  {core}
  admin={shell?.admin ?? false}
  open={route.open}
  onnavigate={route.navigate}
/>
