<!-- One v3 device of the archive and the v5 device it imports into, picked from a select field. -->
<script lang="ts">
  import SelectField from "#lib/components/select-field.svelte";
  import * as Item from "@sunreye/ui/item";

  let {
    slug,
    choices,
    value = $bindable(),
    disabled,
  }: {
    slug: string;
    /** Skipping first, then each v5 device by id. */
    choices: readonly { value: string; label: string }[];
    /** The v5 device id, or empty when it is not imported. */
    value: string;
    disabled: boolean;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  <Item.Content>
    <Item.Title class="text-[15px] font-normal">{slug}</Item.Title>
  </Item.Content>
  <Item.Actions>
    <SelectField bind:value options={choices} label={slug} size="sm" {disabled} />
  </Item.Actions>
</Item.Root>
