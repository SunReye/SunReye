<!-- A select field's list on touch: list rows in a bottom drawer, the chosen one marked. -->
<script lang="ts" generics="Value extends string">
  import Check from "@lucide/svelte/icons/check";
  import type { Snippet } from "svelte";
  import DrawerSheet from "../drawer-sheet.svelte";
  import * as Item from "../ui/item/index.js";
  import { Pressable } from "../ui/pressable/index.js";
  import type { Choice, Section } from "./choices.ts";

  let {
    open = $bindable(false),
    label,
    value,
    sections,
    note,
    item,
    onpick,
  }: {
    open?: boolean;
    label: string;
    value: Value;
    sections: readonly Section<Value>[];
    note?: string | undefined;
    item?: Snippet<[Choice<Value>]> | undefined;
    onpick: (value: Value) => void;
  } = $props();

  const id = $props.id();
</script>

<DrawerSheet bind:open {label} titled>
  <div role="listbox" aria-label={label} class="flex flex-col gap-3">
    {#each sections as section, at (section.heading ?? at)}
      <div role="group" aria-labelledby={section.heading === undefined ? undefined : `${id}-${at}`}>
        {#if section.heading !== undefined}
          <p id="{id}-{at}" class="px-5 pb-1 text-xs text-muted-foreground">{section.heading}</p>
        {/if}
        <Item.Group role="presentation" class="border-y border-border/60">
          {#each section.choices as choice (choice.value)}
            {@render row(choice)}
          {/each}
        </Item.Group>
      </div>
    {/each}
  </div>
  {#if note !== undefined}
    <p class="px-5 pt-3 text-xs text-pretty text-muted-foreground">{note}</p>
  {/if}
</DrawerSheet>

{#snippet row(choice: Choice<Value>)}
  <Item.Root variant="list" size="list" aria-current={choice.value === value}>
    {#snippet child({ props })}
      <Pressable
        {...props}
        role="option"
        aria-selected={choice.value === value}
        onclick={() => {
          onpick(choice.value);
        }}
        class={[props.class, "text-left last:border-b-0"]}
      >
        <Item.Content class="min-w-0 text-[15px]">
          {#if item}{@render item(choice)}{:else}{choice.label}{/if}
        </Item.Content>
        {#if choice.value === value}<Check class="size-4 text-primary" />{/if}
      </Pressable>
    {/snippet}
  </Item.Root>
{/snippet}
