<script lang="ts">
  import type { Snippet } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import "../app.css";
  import { motion } from "../lib/motion/tier.svelte.ts";

  let { children }: { children: Snippet } = $props();

  $effect(() => motion.watch());

  // The CSS motion tokens read the tier (ADR 21).
  $effect(() => {
    document.documentElement.dataset["motion"] = motion.tier;
  });
</script>

<!-- Dark first (ADR 21); a manual choice is kept in local storage. -->
<ModeWatcher defaultMode="dark" />
{@render children()}
