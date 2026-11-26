<!-- The sky's icon (ADR 23 "Dashboard"): decoration beside its word, which says it. -->
<script lang="ts">
  import type { Sky } from "./sky.ts";
  import { DRY } from "./sky-icons-dry.ts";
  import { WET } from "./sky-icons-wet.ts";

  let { sky, class: className = "size-4" }: { sky: Sky; class?: string } = $props();

  const ICONS = { ...DRY, ...WET };

  const Icon = $derived(ICONS[sky]);
</script>

<Icon class={className} aria-hidden="true" />
