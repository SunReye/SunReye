<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Core, SharedArchive } from "../api/core";
  import { buttonVariants } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";

  let {
    core,
    archive,
    mapping = $bindable(),
    disabled,
  }: {
    core: Core;
    /** The chosen archive's v3 devices. */
    archive: readonly SharedArchive["devices"][number][];
    /** The v5 device id each v3 slug maps to; empty when it is not imported. */
    mapping: Record<string, string>;
    disabled: boolean;
  } = $props();

  const id = $props.id();

  // The v5 devices to map them to.
  let targets = $derived(core.devices());
</script>

<div role="group" aria-labelledby="{id}-devices" class="flex flex-col">
  <span id="{id}-devices" class="px-4 text-sm font-medium">{m.import_devices()}</span>
  {#await targets}
    <LoadingRows rows={archive.length} />
  {:then answer}
    {@const choices = [
      { value: "", label: m.import_skip() },
      ...("problem" in answer ? [] : answer).map((target) => ({
        value: String(target.id),
        label: m.import_device({ name: target.name, id: target.id }),
      })),
    ]}
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each archive as device, row (device.slug)}
        {@const chosen = mapping[device.slug] ?? ""}
        <Item.Root class="rounded-none border-0">
          <Item.Content>
            <Item.Title id="{id}-{row}" class="text-[15px] font-normal">{device.slug}</Item.Title>
          </Item.Content>
          <Item.Actions>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                id="{id}-{row}-choice"
                aria-labelledby="{id}-{row} {id}-{row}-choice"
                {disabled}
                class={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {choices.find((choice) => choice.value === chosen)?.label ?? m.import_skip()}
                <ChevronDown data-icon="inline-end" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.RadioGroup
                  bind:value={() => chosen, (next) => (mapping[device.slug] = next)}
                >
                  {#each choices as choice (choice.value)}
                    <DropdownMenu.RadioItem value={choice.value}>{choice.label}</DropdownMenu.RadioItem>
                  {/each}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Item.Actions>
        </Item.Root>
      {/each}
    </Item.Group>
  {/await}
</div>
