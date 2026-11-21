<!-- "+ something" (ADR 21 "One behaviour, one component"): a press adds it, with `light`. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";

  let { text, onadd }: { text: string; onadd: () => void } = $props();
</script>

<Button
  variant="outline"
  size="sm"
  onclick={() => {
    haptics.light();
    onadd();
  }}
>
  <Plus data-icon="inline-start" />{text}
</Button>
