<!-- Fold mode's chart (ADR 22). -->
<script lang="ts">
  import type { ModeProps } from "./mode.ts";
  import PanePending from "./PanePending.svelte";

  let { height }: ModeProps = $props();
</script>

<PanePending {height} />
