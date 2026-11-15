<!-- One gallery entry: a component of the kit (or a primitive) under its name. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  let { name, children }: { name: string; children: Snippet } = $props();
</script>

<section data-gallery={name} class="flex flex-col gap-3 border-b py-5">
  <h3 class="font-mono text-xs text-muted-foreground">{name}</h3>
  <div class="flex flex-wrap items-start gap-4">
    {@render children()}
  </div>
</section>
