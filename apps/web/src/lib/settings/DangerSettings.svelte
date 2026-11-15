<!-- Settings › Danger zone: the import from v3 writes history that no undo takes back (ADR 18). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import ImportPanel from "./ImportPanel.svelte";

  let { core }: { core: Core } = $props();
</script>

<ImportPanel {core} />
