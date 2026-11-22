<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import { cn } from "#lib/utils.js";

  export type CommandRootApi = CommandPrimitive.Root;

  let {
    api = $bindable(null),
    ref = $bindable(null),
    value = $bindable(""),
    class: className,
    ...restProps
  }: CommandPrimitive.RootProps & {
    api?: CommandRootApi | null;
  } = $props();
</script>

<CommandPrimitive.Root
  bind:this={api}
  bind:value
  bind:ref
  data-slot="command"
  // Local: inside a dialog or popover the overlay's glass shows through (ADR 21, #750).
  class={cn(
    "bg-popover in-data-[slot=dialog-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent text-popover-foreground rounded-xl! p-1 flex size-full flex-col overflow-hidden",
    className,
  )}
  {...restProps}
/>
