<!-- A labelled pick of one from a list, on the ui select; the trigger shows the pick's text. -->
<script lang="ts">
  import * as Select from "#lib/components/ui/select/index.js";
  import FormField from "../components/form-field.svelte";

  let {
    label,
    value,
    options,
    onpick,
  }: {
    label: string;
    value: string;
    options: readonly Readonly<{ value: string; text: string }>[];
    onpick: (value: string) => void;
  } = $props();

  const shown = $derived(options.find((option) => option.value === value)?.text ?? value);
</script>

<FormField {label}>
  {#snippet children({ id })}
    <Select.Root type="single" bind:value={() => value, onpick}>
      <Select.Trigger {id} class="w-full">
        <span class="truncate">{shown}</span>
      </Select.Trigger>
      <Select.Content class="max-h-80">
        <Select.Group>
          {#each options as option (option.value)}
            <Select.Item value={option.value} label={option.text} />
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  {/snippet}
</FormField>
