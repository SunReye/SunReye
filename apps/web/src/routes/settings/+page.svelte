<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { drillRoute } from "../../lib/components/drill-in/route.ts";
  import SettingsScreen from "../../lib/settings/SettingsScreen.svelte";
  import { access } from "../../lib/shell/access.svelte.ts";

  const core = useCore();

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
