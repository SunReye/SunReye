<script lang="ts">
  import { connect, http } from "../lib/api/core";
  import LiveScreen from "../lib/LiveScreen.svelte";

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));
</script>

<LiveScreen {core} />
