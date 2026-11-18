<!-- A settings row that picks one of a few: its name, a line of status, and a segmented control. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";

  let {
    label,
    value,
    options,
    hint,
    onchange,
    children,
  }: {
    label: string;
    value: string;
    /** Each option's value and its text. */
    options: readonly (readonly [string, string])[];
    /** Under the label: what the choice does here and now. */
    hint?: string | undefined;
    /** The segment pressed; empty when it is the chosen one again. */
    onchange: (next: string) => void;
    /** Under the hint: an action the status calls for. */
    children?: Snippet;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  <!-- Too narrow for its status beside the segments, the row puts them on a line of their own. -->
  <Item.Content class="min-w-48">
    <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
    {#if hint}<Item.Description>{hint}</Item.Description>{/if}
    {@render children?.()}
  </Item.Content>
  <Item.Actions>
    <ToggleGroup.Root
      type="single"
      size="sm"
      spacing={1}
      bind:value={() => value, onchange}
      class="rounded-md p-0.5 ring-1 ring-border/60"
      aria-label={label}
    >
      {#each options as [option, text] (option)}
        <ToggleGroup.Item value={option} class="px-3 text-xs">{text}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  </Item.Actions>
</Item.Root>
