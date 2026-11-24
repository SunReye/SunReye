<!-- The Buildings group's way into the tracing mode (ADR 20). -->
<script lang="ts">
  import PenLine from "@lucide/svelte/icons/pen-line";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let { onclick }: { onclick: () => void } = $props();
</script>

<div class="p-3 pt-0">
  <Button variant="outline" class="w-full justify-start" {onclick}>
    <PenLine data-icon="inline-start" />
    {m.builder_trace()}
  </Button>
</div>
