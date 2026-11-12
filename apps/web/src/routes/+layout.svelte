<script lang="ts">
  import type { Snippet } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import "../app.css";

  let { children }: { children: Snippet } = $props();
</script>

<!-- Dark first (ADR 21); a manual choice is kept in local storage. -->
<ModeWatcher defaultMode="dark" />
{@render children()}
