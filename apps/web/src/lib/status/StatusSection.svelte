<!-- One surface of the status screen: the settings pane's glass, a titled header and its rows. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    actions,
    children,
  }: { title: string; actions?: Snippet; children: Snippet } = $props();

  const id = $props.id();
</script>

<section
  aria-labelledby={id}
  class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-1"
>
  <header class="flex min-h-12 items-center gap-3 border-b border-border/60 px-4 py-2">
    <h2 {id} class="flex-1 text-[15px] font-semibold">{title}</h2>
    {@render actions?.()}
  </header>
  {@render children()}
</section>
