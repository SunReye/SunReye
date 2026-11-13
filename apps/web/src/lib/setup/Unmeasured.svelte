<!-- A point's own consumption, the part no measured child explains (ADR 14): shown, never hidden. -->
<script lang="ts">
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { m } from "../paraglide/messages.js";

  let { watts }: { watts: number } = $props();
</script>

<div class="flex min-h-14 items-center gap-3 px-4 py-2">
  <span
    class="grid size-9 shrink-0 place-items-center rounded-md border-2 border-dashed border-border text-muted-foreground"
    aria-hidden="true"
  >
    <CircleDashed class="size-5" />
  </span>
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-[15px] text-muted-foreground">{m.topology_unmeasured()}</span>
    <span class="truncate text-xs text-muted-foreground">{m.topology_unmeasured_note()}</span>
  </span>
  <span class="shrink-0 text-[15px] whitespace-nowrap text-muted-foreground">
    <AnimatedNumber value={watts / 1000} />
    <span class="text-xs">kW</span>
  </span>
</div>
