<!--
  One choice from a list, as the kit's Select: the trigger shows the chosen option's label, or the
  value itself where no option has it. The list is overlay glass with a mouse and a bottom drawer
  on touch, as the shell's input decides (ADR 21). Callers give options and take the change; the
  parts stay in here. A `field` shows its label above, as a form's field.
-->
<script lang="ts" generics="Value extends string">
  import type { Snippet } from "svelte";
  import { input } from "@sunreye/builder/shell/input.svelte.ts";
  import FormField from "./form-field.svelte";
  import { sections, type Choice } from "./select/choices.ts";
  import SelectDrawer from "./select/select-drawer.svelte";
  import SelectPopover from "./select/select-popover.svelte";
  import * as Select from "./ui/select/index.js";

  let {
    value = $bindable(),
    options,
    label,
    field = false,
    id,
    size = "default",
    disabled = false,
    note,
    item,
    class: className,
    onchange,
  }: {
    value: Value;
    /** In order; a run of options with one `group` stands under that heading. */
    options: readonly Choice<Value>[];
    /** The control's accessible name, where no visible label points at its `id`. */
    label?: string;
    /** Shows `label` above the control, which then fills the field's width. */
    field?: boolean;
    id?: string;
    size?: "sm" | "default";
    disabled?: boolean;
    /** A line at the list's foot, said once for every option. */
    note?: string | undefined;
    /** An option's row in the list, where its label alone does not say it. */
    item?: Snippet<[Choice<Value>]>;
    class?: string;
    onchange?: (value: Value) => void;
  } = $props();

  let open = $state(false);

  const shown = $derived(options.find((option) => option.value === value)?.label ?? value);
  const runs = $derived(sections(options));

  function choose(next: string): void {
    const chosen = options.find((option) => option.value === next);

    open = false;

    if (chosen === undefined || chosen.value === value) return;

    value = chosen.value;
    onchange?.(chosen.value);
  }
</script>

{#snippet select(at: string | undefined)}
  <!-- On touch the trigger opens the drawer below; the kit's list is left out. -->
  <Select.Root type="single" {value} bind:open onValueChange={choose} {disabled}>
    <Select.Trigger
      {...at === undefined ? {} : { id: at }}
      aria-label={field ? undefined : label}
      {size}
      class={[field && "w-full", className]}
    >
      <span class="truncate">{shown}</span>
    </Select.Trigger>
    {#if input.overlay === "popover"}
      <SelectPopover sections={runs} {note} {item} />
    {/if}
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

{#if input.overlay === "drawer"}
  <SelectDrawer
    bind:open
    label={label ?? ""}
    {value}
    sections={runs}
    {note}
    {item}
    onpick={choose}
  />
{/if}
