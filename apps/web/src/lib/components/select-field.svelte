<!--
  One choice from a list, as the kit's Select: the trigger shows the chosen option's label and the
  list is overlay glass. Callers give options and take the change; the parts stay in here.
-->
<script lang="ts" generics="Value extends string">
  import * as Select from "./ui/select/index.js";

  let {
    value = $bindable(),
    options,
    label,
    id,
    size = "default",
    class: className,
    onchange,
  }: {
    value: Value;
    options: readonly { readonly value: Value; readonly label: string }[];
    /** The control's accessible name, where no visible label points at its `id`. */
    label?: string;
    id?: string;
    size?: "sm" | "default";
    class?: string;
    onchange?: (value: Value) => void;
  } = $props();

  const shown = $derived(options.find((option) => option.value === value)?.label ?? "");

  function choose(next: string): void {
    const chosen = options.find((option) => option.value === next);

    if (chosen === undefined || chosen.value === value) return;

    value = chosen.value;
    onchange?.(chosen.value);
  }
</script>

<Select.Root type="single" {value} onValueChange={choose}>
  <Select.Trigger {...id === undefined ? {} : { id }} {size} aria-label={label} class={className}>
    {shown}
  </Select.Trigger>
  <Select.Content>
    <Select.Group>
      {#each options as option (option.value)}
        <Select.Item value={option.value} label={option.label} />
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
