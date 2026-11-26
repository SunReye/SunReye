<!-- "+ something" (ADR 21 "One behaviour, one component"): a press adds it, with `light`. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "@sunreye/ui/button";
  import { haptics } from "@sunreye/ui/haptics";

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
