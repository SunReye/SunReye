<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { haptics } from "@sunreye/ui/haptics";

  let {
    open = $bindable(false),
    value = $bindable(),
    ...restProps
  }: SelectPrimitive.RootProps = $props();

  // Local: a pick of another option ticks (ADR 21 "One behaviour, one component"). bits-ui writes
  // the value on a user's pick only, the chosen one again too. After the caller.
  function pick(next: typeof value): void {
    const changed = next !== value;

    value = next;

    if (changed) haptics.selection();
  }
</script>

<SelectPrimitive.Root bind:open bind:value={() => value as never, pick as never} {...restProps} />
