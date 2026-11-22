<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { haptics } from "#lib/haptics.ts";

  let {
    ref = $bindable(null),
    value = $bindable(""),
    ...restProps
  }: DropdownMenuPrimitive.RadioGroupProps = $props();

  // Local: a pick of another item ticks (ADR 21 "One behaviour, one component"). bits-ui writes
  // the value on a user's pick only, the chosen one again too. After the caller.
  function pick(next: string): void {
    const changed = next !== value;

    value = next;

    if (changed) haptics.selection();
  }
</script>

<DropdownMenuPrimitive.RadioGroup
  bind:ref
  bind:value={() => value, pick}
  data-slot="dropdown-menu-radio-group"
  {...restProps}
/>
