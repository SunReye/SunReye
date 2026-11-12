<script lang="ts">
  import { connect, http } from "../../lib/api/core";
  import StatusScreen from "../../lib/status/StatusScreen.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));
</script>

<StatusScreen {core} />
