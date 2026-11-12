<script lang="ts">
  import { connect, http } from "../../lib/api/core";
  import SettingsScreen from "../../lib/settings/SettingsScreen.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));
</script>

<SettingsScreen {core} />
