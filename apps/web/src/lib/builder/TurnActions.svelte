<!-- The context toolbar in the turn mode (ADR 20): the picked object's angle as the ring turns it,
  and the way out. -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import ToolButton from "./ToolButton.svelte";

  let { angle, ondone }: { angle: number; ondone: () => void } = $props();

  const shown = $derived(
    new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(angle),
  );
</script>

<span role="status" class="shrink-0 px-2 text-sm font-medium tabular-nums">
  {m.builder_turn_angle({ angle: shown })}
</span>
<ToolButton variant="default" icon={Check} label={m.builder_turn_done()} onclick={ondone} />
