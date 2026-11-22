<!-- A point's tile: the 2D flow node's boxy tile in its energy colour, dimmed while it idles. -->
<script lang="ts">
  import { accentOf, iconOf } from "./point-look.ts";

  let { role, active }: { role: string; active: boolean } = $props();

  const Icon = $derived(iconOf(role));

  const accent = $derived(accentOf(role));
</script>

<span
  class="grid size-9 shrink-0 place-items-center rounded-md border-2"
  style:border-color={active ? accent : "var(--border)"}
  style:background-color={active
    ? `color-mix(in oklab, ${accent} 12%, var(--card))`
    : "var(--card)"}
  style:color={active ? accent : "var(--muted-foreground)"}
  aria-hidden="true"
>
  <Icon class="size-5" />
</span>
