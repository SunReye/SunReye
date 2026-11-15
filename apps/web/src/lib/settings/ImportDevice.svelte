<!-- One v3 device of the archive and the v5 device it imports into, picked from a menu. -->
<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { buttonVariants } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import * as Item from "#lib/components/ui/item/index.js";

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

  const id = $props.id();

  const chosen = $derived(choices.find((choice) => choice.value === value) ?? choices[0]);
</script>

<Item.Root class="rounded-none border-0">
  <Item.Content>
    <Item.Title id="{id}-slug" class="text-[15px] font-normal">{slug}</Item.Title>
  </Item.Content>
  <Item.Actions>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        id="{id}-choice"
        aria-labelledby="{id}-slug {id}-choice"
        {disabled}
        class={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {chosen?.label}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup bind:value>
          {#each choices as choice (choice.value)}
            <DropdownMenu.RadioItem value={choice.value}>{choice.label}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Item.Actions>
</Item.Root>
