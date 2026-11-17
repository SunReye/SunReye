<!-- A sheet's one way onward, at the end where the scan ends (ADR 21). -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import type { Snippet } from "svelte";

  let { href, children }: { href: string; children: Snippet } = $props();
</script>

<a
  {href}
  class="group mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4 text-left text-sm font-medium text-brand outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
>
  {@render children()}
  <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
</a>
