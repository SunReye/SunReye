<!-- A sheet's one way onward, at the end where the scan ends (ADR 21): the text link's onward form
  across the sheet's last row. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import TextLink from "../components/text-link.svelte";

  let { href, children }: { href: string; children: Snippet } = $props();
</script>

<div class="mt-auto border-t border-border/60 px-5 py-4 text-sm sm:px-6">
  <TextLink onward {href} class="w-full justify-between">{@render children()}</TextLink>
</div>
