<!--
  One choice from a list, as the kit's Select: the trigger shows the chosen option's label, or the
  value itself where no option has it, and the list is overlay glass. Callers give options and take
  the change; the parts stay in here. A `field` shows its label above, as a form's field.
-->
<script lang="ts" generics="Value extends string">
  import FormField from "./form-field.svelte";
  import * as Select from "./ui/select/index.js";

  let {
    value = $bindable(),
    options,
    label,
    field = false,
    id,
    size = "default",
    class: className,
    onchange,
  }: {
    value: Value;
    options: readonly { readonly value: Value; readonly label: string }[];
    /** The control's accessible name, where no visible label points at its `id`. */
    label?: string;
    /** Shows `label` above the control, which then fills the field's width. */
    field?: boolean;
    id?: string;
    size?: "sm" | "default";
    class?: string;
    onchange?: (value: Value) => void;
  } = $props();

  const shown = $derived(options.find((option) => option.value === value)?.label ?? value);

  function choose(next: string): void {
    const chosen = options.find((option) => option.value === next);

    if (chosen === undefined || chosen.value === value) return;

    value = chosen.value;
    onchange?.(chosen.value);
  }
</script>

{#snippet select(at: string | undefined)}
  <Select.Root type="single" {value} onValueChange={choose}>
    <Select.Trigger
      {...at === undefined ? {} : { id: at }}
      aria-label={field ? undefined : label}
      {size}
      class={[field && "w-full", className]}
    >
      <span class="truncate">{shown}</span>
    </Select.Trigger>
    <Select.Content>
      <Select.Group>
        {#each options as option (option.value)}
          <Select.Item value={option.value} label={option.label} />
        {/each}
      </Select.Group>
    </Select.Content>
  </Select.Root>
{/snippet}

{#if field}
  <FormField label={label ?? ""}>
    {#snippet children({ id: at })}
      {@render select(at)}
    {/snippet}
  </FormField>
{:else}
  {@render select(id)}
{/if}
