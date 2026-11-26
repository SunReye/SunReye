<!-- Settings › Users & access: who else reaches the core, as viewer or through a token (ADR 9). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import TokenAccess from "./TokenAccess.svelte";
  import ViewerAccess from "./ViewerAccess.svelte";

  let { core }: { core: Core } = $props();
</script>

<div class="flex flex-col divide-y divide-border/60 drill:divide-y-0">
  <ViewerAccess {core} />
  <TokenAccess {core} />
</div>
