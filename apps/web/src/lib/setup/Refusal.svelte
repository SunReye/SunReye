<script lang="ts">
  import type { Problem } from "../api/core.ts";
  import { problemText } from "../i18n/problems";

  let { refused }: { refused: Problem | undefined } = $props();
</script>

{#if refused !== undefined}
  <p role="alert">{problemText(refused.problem)}</p>
{/if}
