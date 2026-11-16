<!--
  Who the imported surroundings are owed to (ADR 20 Look): one line on the canvas's lower edge
  while they are drawn. It never wraps or grows: what does not fit scrolls sideways.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";

  let { credits }: { credits: readonly string[] } = $props();
</script>

{#if credits.length > 0}
  <p
    aria-label={m.scene_credits()}
    class="pointer-events-auto max-w-full self-start overflow-x-auto text-[11px] leading-4 whitespace-nowrap text-muted-foreground scroll-fade-x no-scrollbar"
  >
    {credits.join(" · ")}
  </p>
{/if}
