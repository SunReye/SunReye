<script lang="ts">
  import { connect, http } from "../../lib/api/core";
  import HistoryScreen from "../../lib/history/HistoryScreen.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));
</script>

<HistoryScreen {core} />
